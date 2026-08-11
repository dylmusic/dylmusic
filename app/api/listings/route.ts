import { NextRequest, NextResponse } from "next/server";
import type { Address } from "viem";
import { saveSiteListings, getSiteListingsForChain, getSiteListing, removeSiteListing } from "@/lib/siteListingsStore";
import { serverPublicClientFor } from "@/lib/serverEvmClient";
import { DylCollectionAbi } from "@/lib/contractDeploy";
import type { StoredListing } from "@/lib/siteListing";

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
// DELETE is different: it's called by the BUYER right after a successful
// purchase (not the seller), so it can't use the same "matches the wallet"
// check — and unlike POST, a bad DELETE actually harms someone else (it
// hides a real, still-fulfillable listing from the site's own UI). Guarded
// instead with a real on-chain read: only removable once the token's
// CURRENT owner no longer matches the stored listing's seller — i.e. proof
// the sale genuinely happened, not just a guessed tokenId.

export async function GET(req: NextRequest) {
  const chainId = Number(req.nextUrl.searchParams.get("chainId"));
  if (!chainId) {
    return NextResponse.json({ error: "Missing chainId." }, { status: 400 });
  }
  const listings = await getSiteListingsForChain(chainId);
  return NextResponse.json({ listings });
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
  const body = await req.json().catch(() => null);
  const chainId = Number(body?.chainId);
  const tokenId = Number(body?.tokenId);
  if (!chainId || !Number.isFinite(tokenId)) {
    return NextResponse.json({ error: "Missing chainId or tokenId." }, { status: 400 });
  }
  const listing = await getSiteListing(chainId, tokenId);
  if (!listing) {
    return NextResponse.json({ ok: true }); // already gone, nothing to do
  }
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
  const ok = await removeSiteListing(chainId, tokenId);
  return NextResponse.json({ ok });
}
