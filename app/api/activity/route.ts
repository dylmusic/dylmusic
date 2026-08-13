import { NextRequest, NextResponse } from "next/server";
import { recordRealActivity, readRealActivity, activityStoreConfigured } from "@/lib/activityStore";

export async function GET(req: NextRequest) {
  if (!activityStoreConfigured()) {
    return NextResponse.json({ configured: false, activity: [] });
  }
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "100");
  const activity = await readRealActivity(Math.min(Math.max(limit, 1), 500));
  return NextResponse.json({ configured: true, activity });
}

// Self-reported by the client right after a real on-chain buy/sell
// confirms — same trust model as every other client-reported telemetry in
// this app (e.g. /api/listings' POST), not independently re-verified
// on-chain here. Fire-and-forget from every call site: a failure here
// never blocks or fails a purchase/listing that already genuinely
// succeeded, it just means that one event is missing from the public feed.
export async function POST(req: NextRequest) {
  if (!activityStoreConfigured()) {
    return NextResponse.json({ error: "Activity store isn't set up yet." }, { status: 503 });
  }
  const body = await req.json().catch(() => null);
  const type = body?.type === "buy" || body?.type === "sell" ? body.type : null;
  const chain = typeof body?.chain === "string" ? body.chain.trim() : "";
  const wallet = typeof body?.wallet === "string" ? body.wallet.trim() : "";
  const trackTitle = typeof body?.trackTitle === "string" ? body.trackTitle.trim() : "";
  const editionNumber = typeof body?.editionNumber === "number" ? body.editionNumber : null;
  const priceUsd = typeof body?.priceUsd === "number" ? body.priceUsd : 0;
  const txHash = typeof body?.txHash === "string" ? body.txHash : undefined;

  if (!type || !chain || !wallet || !trackTitle) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
  }

  const entry = await recordRealActivity({ type, chain, wallet, trackTitle, editionNumber, priceUsd, txHash });
  return NextResponse.json({ ok: !!entry, entry });
}
