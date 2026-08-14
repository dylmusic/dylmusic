import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, type Address } from "viem";
import { getLedger, reserveVoucherCredits, burnLedgerConfigured } from "@/lib/burnLedgerStore";
import { signClaimVoucher, newClaimId } from "@/lib/burnClaimSigner";
import { CONTRACT_TARGETS } from "@/lib/admin";
import { DylCollectionAbi } from "@/lib/contractDeploy";
import { ROBINHOOD_CHAIN_SERVER, ROBINHOOD_RPC_URL } from "@/lib/robinhoodChainServer";
import { ALBUMS } from "@/lib/albums";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";

const VOUCHER_TTL_SECONDS = 30 * 60; // 30 minutes — matches the pending-credit rollback window

// Real trackIds only, Robinhood Chain only for now (per the burn-and-mint
// plan's "enable Robinhood only" scope) — every album's real tracks,
// flattened, deduped by index.
const REAL_TRACK_INDICES = Array.from(new Set(ALBUMS.flatMap((a) => a.tracks.map((t) => t.index))));

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Mint is genuinely random per the site's own "you may or may not get the
// full album" framing — this is the ONE place that randomness is decided,
// locked into the signed voucher at issuance time so there's no on-chain
// randomness (blockhash/timestamp) for anyone to game. Round-robins across
// shuffled tracks with real remaining room until `count` slots are placed
// or every track is full, whichever comes first — never over-assigns a
// track past what the chain can actually deliver.
function assignRandomEditions(count: number, remainingByTrack: Map<number, number>): Map<number, number> {
  const assigned = new Map<number, number>();
  let left = count;
  while (left > 0) {
    const eligible = shuffle([...remainingByTrack.entries()].filter(([, rem]) => rem > 0));
    if (eligible.length === 0) break; // whole catalog sold out
    for (const [trackId, rem] of eligible) {
      if (left <= 0) break;
      assigned.set(trackId, (assigned.get(trackId) ?? 0) + 1);
      remainingByTrack.set(trackId, rem - 1);
      left -= 1;
    }
  }
  return assigned;
}

export async function POST(req: NextRequest) {
  if (!burnLedgerConfigured()) {
    return NextResponse.json({ error: "Burn ledger isn't set up yet." }, { status: 503 });
  }
  // Same reasoning as /api/burn/verify: this does a real RPC read (live
  // per-track availability) plus a real EIP-712 signing operation on every
  // call, and a worthless/empty wallet still costs a full ledger read
  // before it's rejected — nothing else stops a scripted loop from hitting
  // this repeatedly. Throttle by IP, fails open if Redis isn't configured.
  const allowed = await checkRateLimit(`dylmusic:rl:claimvoucher:${clientIp(req)}`, 20, 60);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests — try again in a minute." }, { status: 429 });
  }
  const body = await req.json().catch(() => null);
  const wallet = typeof body?.wallet === "string" ? body.wallet.trim() : "";
  const requested = Number(body?.robinhoodCount);
  if (!wallet || !wallet.startsWith("0x") || !Number.isInteger(requested) || requested <= 0) {
    return NextResponse.json({ error: "Invalid wallet or robinhoodCount." }, { status: 400 });
  }

  const target = CONTRACT_TARGETS.find((t) => t.key === "robinhood");
  if (!target?.address || !target.burnClaimRedeemerAddress || !target.chainId) {
    return NextResponse.json({ error: "Burn-and-mint claiming isn't deployed on Robinhood Chain yet." }, { status: 503 });
  }

  try {
    // Never trust a client-supplied credit total — re-derive spendable
    // fresh (reconciled against real on-chain claimed state) right here.
    const ledger = await getLedger(wallet);
    if (ledger.spendable <= 0) {
      return NextResponse.json({ error: "No spendable free mints available." }, { status: 400 });
    }

    const client = createPublicClient({ chain: ROBINHOOD_CHAIN_SERVER, transport: http(ROBINHOOD_RPC_URL) });
    const editionsPerTrack = (await client.readContract({
      address: target.address as Address,
      abi: DylCollectionAbi,
      functionName: "editionsPerTrack",
    })) as bigint;

    const nextIndices = await Promise.all(
      REAL_TRACK_INDICES.map((idx) =>
        client.readContract({
          address: target.address as Address,
          abi: DylCollectionAbi,
          functionName: "nextEditionIndex",
          args: [BigInt(idx)],
        }) as Promise<bigint>
      )
    );
    const remainingByTrack = new Map<number, number>();
    REAL_TRACK_INDICES.forEach((idx, i) => {
      const remaining = Number(editionsPerTrack - nextIndices[i]);
      if (remaining > 0) remainingByTrack.set(idx, remaining);
    });
    const totalAvailable = [...remainingByTrack.values()].reduce((s, n) => s + n, 0);

    // Grant whatever's actually deliverable — never promise more than the
    // real remaining public pool has, and never reserve more credits than
    // will actually be spent.
    const granted = Math.min(requested, ledger.spendable, totalAvailable);
    if (granted <= 0) {
      return NextResponse.json({ error: "Nothing available to claim right now — the catalog may be sold out." }, { status: 400 });
    }

    const assigned = assignRandomEditions(granted, remainingByTrack);
    const actualGranted = [...assigned.values()].reduce((s, n) => s + n, 0);
    if (actualGranted <= 0) {
      return NextResponse.json({ error: "Nothing available to claim right now — the catalog may be sold out." }, { status: 400 });
    }

    const claimId = newClaimId();
    const expiry = Math.floor(Date.now() / 1000) + VOUCHER_TTL_SECONDS;

    const reserved = await reserveVoucherCredits(wallet, claimId, actualGranted, expiry);
    if (!reserved) {
      return NextResponse.json({ error: "Credits changed before this could be issued — try again." }, { status: 409 });
    }

    const trackIds = [...assigned.keys()];
    const quantities = trackIds.map((id) => assigned.get(id)!);

    const voucher = {
      wallet: wallet as Address,
      collection: target.address as Address,
      trackIds: trackIds.map((id) => BigInt(id)),
      quantities: quantities.map((q) => BigInt(q)),
      claimId,
      expiry: BigInt(expiry),
      chainId: BigInt(target.chainId),
    };
    const { signature } = await signClaimVoucher("robinhood", voucher);

    return NextResponse.json({
      granted: actualGranted,
      requested,
      voucher: {
        wallet,
        collection: target.address,
        trackIds,
        quantities,
        claimId,
        expiry,
        chainId: target.chainId,
      },
      signature,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to issue claim voucher." }, { status: 500 });
  }
}
