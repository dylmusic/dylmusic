import { NextRequest, NextResponse } from "next/server";
import { postMessage, readMessages, deleteMessage, setMessagePinned, chatConfigured } from "@/lib/chatStore";
import { isAdminWallet } from "@/lib/admin";

// Polled every 5-8s by GlobalChatWidget (mounted on every page) and the
// /chat page itself — every open tab/visitor was hitting this fresh with
// zero caching. A short edge cache doesn't change the client's own poll
// interval or add perceptible staleness (s-maxage stays under the
// tightest real poll interval, 5s) — it just collapses however many
// concurrent pollers there are into ~1 real read per window, the same
// pattern already proven for hoodprinter's /api/stats.
//
// Kill switch, defaulted off (2026-08-14, after /api/listings had to get
// one under pressure): this route is cached, which means a rate limit
// placed inside the function can't stop a runaway/broken caller — most
// repeat requests never reach this code at all, they're served straight
// from the CDN cache. If this endpoint is ever the one getting hammered,
// flip GET_CHAT_DISABLED to short-circuit to a free static response
// instead of writing an emergency patch live.
const GET_CHAT_DISABLED = false;

export async function GET() {
  if (GET_CHAT_DISABLED) {
    return NextResponse.json(
      { configured: true, messages: [] },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } }
    );
  }
  if (!chatConfigured()) {
    return NextResponse.json({ configured: false, messages: [] });
  }
  const messages = await readMessages(100);
  return NextResponse.json(
    { configured: true, messages },
    { headers: { "Cache-Control": "public, s-maxage=3, stale-while-revalidate=15" } }
  );
}

export async function POST(req: NextRequest) {
  if (!chatConfigured()) {
    return NextResponse.json({ error: "Chat isn't set up yet." }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const wallet = typeof body?.wallet === "string" ? body.wallet.trim() : "";
  const chain = typeof body?.chain === "string" ? body.chain.trim() : "";
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!wallet || !chain) {
    return NextResponse.json({ error: "Connect a wallet first." }, { status: 400 });
  }
  if (!text || text.length > 500) {
    return NextResponse.json({ error: "Message must be 1-500 characters." }, { status: 400 });
  }

  // No real contracts deployed yet (same as every other "ownership" check in
  // this prototype) — the client only lets this request fire if its own
  // local ledger shows the wallet holding an edition, and this endpoint
  // trusts that self-report rather than re-verifying on-chain. Real
  // verification is the natural next step once editions are real NFTs.
  const message = await postMessage({ wallet, chain, text });
  return NextResponse.json({ message });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  const wallet = typeof body?.wallet === "string" ? body.wallet : "";
  if (!isAdminWallet(wallet)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  if (!id) {
    return NextResponse.json({ error: "Missing message id." }, { status: 400 });
  }
  const ok = await deleteMessage(id);
  return NextResponse.json({ ok });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  const wallet = typeof body?.wallet === "string" ? body.wallet : "";
  const pinned = body?.pinned === true;
  if (!isAdminWallet(wallet)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  if (!id) {
    return NextResponse.json({ error: "Missing message id." }, { status: 400 });
  }
  const ok = await setMessagePinned(id, pinned);
  return NextResponse.json({ ok });
}
