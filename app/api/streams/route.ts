import { NextRequest, NextResponse } from "next/server";
import { incrementStream, readStreamCounts, streamsConfigured } from "@/lib/streamsStore";

export async function GET() {
  if (!streamsConfigured()) {
    return NextResponse.json({ configured: false, counts: {} });
  }
  const counts = await readStreamCounts();
  return NextResponse.json(
    { configured: true, counts },
    { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=60" } }
  );
}

export async function POST(req: NextRequest) {
  if (!streamsConfigured()) {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
  const body = await req.json().catch(() => null);
  const trackId = typeof body?.trackId === "string" ? body.trackId.trim() : "";
  if (!trackId) {
    return NextResponse.json({ error: "Missing trackId." }, { status: 400 });
  }
  const count = await incrementStream(trackId);
  return NextResponse.json({ ok: true, count });
}
