import { NextRequest, NextResponse } from "next/server";
import type { Address } from "viem";
import { saveSiteListings, getSiteListingsForChain, getSiteListing, removeSiteListing } from "@/lib/siteListingsStore";
import { serverPublicClientFor } from "@/lib/serverEvmClient";
import { DylCollectionAbi } from "@/lib/contractDeploy";
import type { StoredListing } from "@/lib/siteListing";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";

// Persists real, signed 0%-fee Seaport listings — the signing happens
// client-side (whichever wallet owns the token), this just stores the
// already-signed order so every visitor's browser can see/fulfill it later.
// Reads are public (any visitor needs to see current listings).
//
// Write access (2026-08-11): opened up from admin-only to any wallet, so a
// regular user's own "List for sale" can post here too — the admin
// premint flow is no longer the only writer. Not re-verifying on-chain
// ownership on POST on purpose: the real security backstop is Seaport
// itself, which will simply refuse to let anyone fulfill a sell order the
// signer doesn't actually own the token for. POST only checks
// self-consistency (the submitted seller matches the submitting wallet) to
// keep out obviously-wrong/spam submissions, same trust model already used
// elsewhere in this app for self-reported data.
//
// DELETE has two legitimate callers with different proof: the BUYER right
// after a successful purchase (can't use POST's "matches the wallet" check
// since the buyer isn't the seller), or the SELLER cancelling their own
// still-unsold listing (lib/siteListing.ts cancelSiteListing — a real
// on-chain Seaport cancel happens before this is ever called). Unlike
// POST, a bad DELETE actually harms someone else (it hides a real,
// still-fulfillable listing from the site's own UI), so it's not just a
// self-reported wallet match: either (a) the submitted wallet matches the
// listing's own seller (the seller has an unconditional right to hide
// their own listing), or (b) a real on-chain read shows the token's
// CURRENT owner no longer matches the stored listing's seller — proof a
// sale genuinely happened, not just a guessed tokenId.

export async function GET(req: NextRequest) {
  // Hard backstop, independent of any client-side bug — a stale browser
  // tab (or anything else) hammering this endpoint has no way to know the
  // server changed and will keep calling at whatever rate its own broken
  // code runs at, forever, no matter how many times we redeploy. This caps
  // the actual work done per source regardless of why it's happening.
  // Generous limit (this is legitimately polled) — this is a ceiling
  // against a runaway/malicious source, not a normal-usage throttle.
  const allowed = await checkRateLimit(`dylmusic:rl:listingsget:${clientIp(req)}`, 120, 60);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=30" } }
    );
  }
  const chainId = Number(req.nextUrl.searchParams.get("chainId"));
  if (!chainId) {
    return NextResponse.json({ error: "Missing chainId." }, { status: 400 });
  }
  const listings = await getSiteListingsForChain(chainId);
  // Short edge cache only — a stale listing here can never cause a bad
  // purchase (Seaport itself refuses to fulfill an already-sold/cancelled
  // order, per the design note above), it just collapses repeat reads from
  // concurrent visitors browsing the same track list within a few seconds.
  return NextResponse.json({ listings }, { headers: { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=30" } });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const wallet = typeof body?.wallet === "string" ? body.wallet : "";
  const listings = Array.isArray(body?.listings) ? (body.listings as StoredListing[]) : [];
  if (!wallet) {
    return NextResponse.json({ error: "Missing wallet." }, { status: 400 });
  }
  if (listings.length === 0) {
    return NextResponse.json({ error: "No listings provided." }, { status: 400 });
  }
  const mismatched = listings.some((l) => l.sellerAddress.toLowerCase() !== wallet.toLowerCase());
  if (mismatched) {
    return NextResponse.json({ error: "Every listing's sellerAddress must match the submitting wallet." }, { status: 403 });
  }
  const ok = await saveSiteListings(listings);
  return NextResponse.json({ ok });
}

export async function DELETE(req: NextRequest) {
  // The non-seller ("proven sale") branch below does a real on-chain
  // ownerOf() read — a scripted loop hitting this with a non-matching
  // wallet and arbitrary tokenIds would force a real RPC call on every
  // request with nothing else stopping it. Throttle by IP.
  const allowed = await checkRateLimit(`dylmusic:rl:listingsdelete:${clientIp(req)}`, 30, 60);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests — try again in a minute." }, { status: 429 });
  }
  const body = await req.json().catch(() => null);
  const chainId = Number(body?.chainId);
  const tokenId = Number(body?.tokenId);
  const wallet = typeof body?.wallet === "string" ? body.wallet : "";
  if (!chainId || !Number.isFinite(tokenId)) {
    return NextResponse.json({ error: "Missing chainId or tokenId." }, { status: 400 });
  }
  const listing = await getSiteListing(chainId, tokenId);
  if (!listing) {
    return NextResponse.json({ ok: true }); // already gone, nothing to do
  }

  const isSellerCancelling = !!wallet && wallet.toLowerCase() === listing.sellerAddress.toLowerCase();
  if (!isSellerCancelling) {
    const client = serverPublicClientFor(chainId);
    if (!client) {
      return NextResponse.json({ error: `No public RPC configured for chain ${chainId}.` }, { status: 500 });
    }
    const currentOwner = (await client.readContract({
      address: listing.collectionAddress as Address,
      abi: DylCollectionAbi,
      functionName: "ownerOf",
      args: [BigInt(tokenId)],
    })) as string;
    if (currentOwner.toLowerCase() === listing.sellerAddress.toLowerCase()) {
      return NextResponse.json(
        { error: "Token still owned by the listing's seller — this listing hasn't actually sold, refusing to remove it." },
        { status: 409 }
      );
    }
  }

  const ok = await removeSiteListing(chainId, tokenId);
  return NextResponse.json({ ok });
}
