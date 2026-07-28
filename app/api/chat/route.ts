import { NextRequest, NextResponse } from "next/server";
import { postMessage, readMessages, deleteMessage, setMessagePinned, chatConfigured } from "@/lib/chatStore";
import { isAdminWallet } from "@/lib/admin";

export async function GET() {
  if (!chatConfigured()) {
    return NextResponse.json({ configured: false, messages: [] });
  }
  const messages = await readMessages(100);
  return NextResponse.json({ configured: true, messages });
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
