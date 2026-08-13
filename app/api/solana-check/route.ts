import { NextRequest, NextResponse } from "next/server";
import { checkSolanaWallet } from "@/lib/solanaCollectionCheck";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address")?.trim();
  if (!address) {
    return NextResponse.json({ error: "Missing address." }, { status: 400 });
  }
  // Real per-wallet Solana RPC scan (getParsedTokenAccountsByOwner + up to
  // 250 NFT metadata lookups) — same reasoning as /api/burn/verify's
  // throttle, nothing else limits how often this can be called.
  const allowed = await checkRateLimit(`dylmusic:rl:solanacheck:${clientIp(req)}`, 20, 60);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests — try again in a minute." }, { status: 429 });
  }
  const result = await checkSolanaWallet(address);
  return NextResponse.json(result, { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" } });
}
