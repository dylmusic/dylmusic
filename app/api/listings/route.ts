import { NextRequest, NextResponse } from "next/server";
import { saveSiteListings, getSiteListingsForChain } from "@/lib/siteListingsStore";
import { isAdminWallet } from "@/lib/admin";
import type { StoredListing } from "@/lib/siteListing";

// Persists the admin panel's own-site (0%-fee) Seaport listings — the
// signing happens client-side (the admin's wallet), this just stores the
// already-signed order so every visitor's browser can see/fulfill it later.
// Admin-gated on write since only the deployment premint flow creates these
// today; reads are public (any visitor needs to see current listings).

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
  if (!isAdminWallet(wallet)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  if (listings.length === 0) {
    return NextResponse.json({ error: "No listings provided." }, { status: 400 });
  }
  const ok = await saveSiteListings(listings);
  return NextResponse.json({ ok });
}
