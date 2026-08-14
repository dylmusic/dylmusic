import { NextRequest, NextResponse } from "next/server";
import { incrementStream, readStreamCounts, streamsConfigured } from "@/lib/streamsStore";

// Kill switch, defaulted off — same reasoning as the other polled cached
// GET routes. Ready to flip GET_STREAMS_DISABLED without an emergency
// patch if this route is ever the one getting hammered.
const GET_STREAMS_DISABLED = false;

export async function GET() {
  if (GET_STREAMS_DISABLED) {
    return NextResponse.json(
      { configured: true, counts: {} },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } }
    );
  }
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
