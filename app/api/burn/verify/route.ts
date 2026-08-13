import { NextRequest, NextResponse } from "next/server";
import {
  verifyEthereumNftBurn,
  verifyEvmDylBurnedAmount,
  verifyTezosNftBurn,
  verifySolanaBurn,
  verifySolanaDylBurnedAmount,
} from "@/lib/burnVerify";
import { fetchSingleInstanceTier } from "@/lib/tieredCollectionCheck";
import { fetchMintTier } from "@/lib/solanaCollectionCheck";
import { CARD_TIER_MINTS, VIP_MINTS_ESTIMATE, dylMintsForBalance } from "@/lib/burnCredits";
import { recordBurnCredit, recordDylThresholdCredit, getLedger, burnLedgerConfigured } from "@/lib/burnLedgerStore";
import { LEGACY_ASSETS } from "@/lib/legacyCollections";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";

const TIERED_ETH_CONTRACT = LEGACY_ASSETS.find((a) => a.name === "Old Dyl NFT collection")!.address;
const TEZOS_CONTRACT = LEGACY_ASSETS.find((a) => a.chain === "tezos" && a.kind === "nft")!.address;
const DYL_SOL_MINT = LEGACY_ASSETS.find((a) => a.chain === "solana" && a.kind === "token")!.address;
const DYL_BY_CHAIN: Record<"ethereum" | "base" | "polygon", string> = {
  ethereum: LEGACY_ASSETS.find((a) => a.chain === "ethereum" && a.kind === "token")!.address,
  base: LEGACY_ASSETS.find((a) => a.chain === "base" && a.kind === "token")!.address,
  polygon: LEGACY_ASSETS.find((a) => a.chain === "polygon" && a.kind === "token")!.address,
};

// The one endpoint that turns a real burn into real free-mint credit —
// EVERY case here independently re-derives the burn from the origin
// chain's own indexer/RPC (lib/burnVerify.ts) before crediting anything;
// the client only ever supplies WHICH thing to go check, never an amount
// or a "trust me, I burned it" claim.
//
// `wallet` is ALWAYS the EVM wallet the ledger is keyed by and that will
// eventually submit the claim (claiming only ever happens on an EVM chain —
// see lib/burnClaimSigner.ts) — safe to lowercase (lib/burnLedgerStore.ts
// does), since EVM addresses are case-insensitive. For a burn whose PROOF
// lives on a different chain (Solana/Tezos), `originWallet` is the actual
// address that chain's own indexer/RPC needs to check the burn against —
// a Solana base58 address is case-SENSITIVE, so it must never be the thing
// used as (or lowercased into) the Redis ledger key. The two are genuinely
// different wallets belonging to the same person, not the same address in
// two formats.
export async function POST(req: NextRequest) {
  if (!burnLedgerConfigured()) {
    return NextResponse.json({ error: "Burn ledger isn't set up yet." }, { status: 503 });
  }
  // Every kind here does real, expensive external work per call — one
  // Solana kind alone can fire up to 1000 sequential RPC calls (see
  // lib/burnVerify.ts's verifySolanaDylBurnedAmount). Nothing else stops a
  // scripted loop from hammering this repeatedly, so throttle by IP.
  const allowed = await checkRateLimit(`dylmusic:rl:burnverify:${clientIp(req)}`, 20, 60);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests — try again in a minute." }, { status: 429 });
  }
  const body = await req.json().catch(() => null);
  const wallet = typeof body?.wallet === "string" ? body.wallet.trim() : "";
  const originWallet = typeof body?.originWallet === "string" ? body.originWallet.trim() : wallet;
  const kind = body?.kind;
  if (!wallet || !wallet.startsWith("0x") || !kind) {
    return NextResponse.json({ error: "Missing or invalid (must be 0x…) EVM wallet, or missing kind." }, { status: 400 });
  }

  try {
    if (kind === "eth-tiered-nft") {
      const tokenId = String(body?.tokenId ?? "");
      if (!tokenId) return NextResponse.json({ error: "Missing tokenId." }, { status: 400 });
      const burn = await verifyEthereumNftBurn(wallet, TIERED_ETH_CONTRACT, tokenId);
      if (burn.error) return NextResponse.json({ error: burn.error }, { status: 502 });
      if (!burn.burned) return NextResponse.json({ credited: false, amount: 0, reason: "No matching burn found yet." });

      const { tier } = await fetchSingleInstanceTier(tokenId);
      const amount =
        tier === "vip"
          ? VIP_MINTS_ESTIMATE
          : tier === "standard" || tier === "gold" || tier === "platinum"
            ? (CARD_TIER_MINTS[tier] ?? 0)
            : 0; // diamond (unpriced) and mystery/unknown credit nothing rather than guess
      if (amount <= 0) {
        return NextResponse.json({ credited: false, amount: 0, reason: "This item's tier isn't priced yet." });
      }
      const result = await recordBurnCredit(`nft:ethereum:${TIERED_ETH_CONTRACT}:${tokenId}`, wallet, amount);
      const ledger = await getLedger(wallet);
      return NextResponse.json({ credited: result.credited, amount: result.credited ? amount : 0, ledger });
    }

    if (kind === "dyl") {
      const chainRaw = body?.chain;
      if (chainRaw !== "ethereum" && chainRaw !== "base" && chainRaw !== "polygon") {
        return NextResponse.json({ error: "Invalid chain for $DYL." }, { status: 400 });
      }
      const chain: "ethereum" | "base" | "polygon" = chainRaw;
      const burned = await verifyEvmDylBurnedAmount(chain, wallet, DYL_BY_CHAIN[chain]);
      if (burned.error) return NextResponse.json({ error: burned.error }, { status: 502 });
      const currentMints = dylMintsForBalance(burned.totalBurned);
      const result = await recordDylThresholdCredit(chain, wallet, currentMints);
      const ledger = await getLedger(wallet);
      return NextResponse.json({ credited: result.credited > 0, amount: result.credited, totalBurned: burned.totalBurned, ledger });
    }

    if (kind === "solana-card") {
      const mintAddress = typeof body?.mintAddress === "string" ? body.mintAddress : "";
      if (!mintAddress) return NextResponse.json({ error: "Missing mintAddress." }, { status: 400 });
      const burn = await verifySolanaBurn(originWallet, mintAddress);
      if (burn.error) return NextResponse.json({ error: burn.error }, { status: 502 });
      if (!burn.burned) return NextResponse.json({ credited: false, amount: 0, reason: "No matching burn found yet." });

      const { verifiedOurs, tier } = await fetchMintTier(mintAddress);
      const amount = verifiedOurs && tier ? (CARD_TIER_MINTS[tier] ?? 0) : 0;
      if (amount <= 0) {
        return NextResponse.json({ credited: false, amount: 0, reason: "This card's tier isn't priced yet, or isn't from our collection." });
      }
      const result = await recordBurnCredit(`nft:solana:${mintAddress}`, wallet, amount);
      const ledger = await getLedger(wallet);
      return NextResponse.json({ credited: result.credited, amount: result.credited ? amount : 0, ledger });
    }

    if (kind === "solana-dyl") {
      const burned = await verifySolanaDylBurnedAmount(originWallet, DYL_SOL_MINT);
      if (burned.error) return NextResponse.json({ error: burned.error }, { status: 502 });
      const currentMints = dylMintsForBalance(burned.totalBurned);
      const result = await recordDylThresholdCredit("solana", wallet, currentMints);
      const ledger = await getLedger(wallet);
      return NextResponse.json({ credited: result.credited > 0, amount: result.credited, totalBurned: burned.totalBurned, ledger });
    }

    if (kind === "tezos-nft") {
      const tokenId = String(body?.tokenId ?? "");
      if (!tokenId) return NextResponse.json({ error: "Missing tokenId." }, { status: 400 });
      const burn = await verifyTezosNftBurn(originWallet, TEZOS_CONTRACT, tokenId);
      if (burn.error) return NextResponse.json({ error: burn.error }, { status: 502 });
      if (!burn.burned) return NextResponse.json({ credited: false, amount: 0, reason: "No matching burn found yet." });

      const amount = 1; // "Tezos | any 1 NFT | 1 mint" — flat, per the burn reward table
      const result = await recordBurnCredit(`nft:tezos:${TEZOS_CONTRACT}:${tokenId}`, wallet, amount);
      const ledger = await getLedger(wallet);
      return NextResponse.json({ credited: result.credited, amount: result.credited ? amount : 0, ledger });
    }

    return NextResponse.json({ error: `Unknown kind "${kind}".` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Verification failed." }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  if (!burnLedgerConfigured()) {
    return NextResponse.json({ configured: false, ledger: { earned: 0, pending: 0, spent: 0, spendable: 0 } });
  }
  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ error: "Missing wallet." }, { status: 400 });
  const ledger = await getLedger(wallet);
  return NextResponse.json({ configured: true, ledger });
}
