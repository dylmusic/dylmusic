import { NextRequest, NextResponse } from "next/server";
import {
  postNote,
  readNotes,
  deleteNote,
  setNotePinned,
  boardConfigured,
  isNoteColor,
  DEFAULT_NOTE_COLOR,
} from "@/lib/boardStore";
import { isAdminWallet } from "@/lib/admin";

// Polled every 8s by BulletinBoard — same edge-cache-collapses-concurrent-
// polls reasoning as /api/chat.
export async function GET() {
  if (!boardConfigured()) {
    return NextResponse.json({ configured: false, notes: [] });
  }
  const notes = await readNotes(300);
  return NextResponse.json(
    { configured: true, notes },
    { headers: { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=30" } }
  );
}

export async function POST(req: NextRequest) {
  if (!boardConfigured()) {
    return NextResponse.json({ error: "The board isn't set up yet." }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const wallet = typeof body?.wallet === "string" ? body.wallet.trim() : "";
  const chain = typeof body?.chain === "string" ? body.chain.trim() : "";
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const color = isNoteColor(body?.color) ? body.color : DEFAULT_NOTE_COLOR;

  if (!wallet || !chain) {
    return NextResponse.json({ error: "Connect a wallet first." }, { status: 400 });
  }
  if (!text || text.length > 200) {
    return NextResponse.json({ error: "Message must be 1-200 characters." }, { status: 400 });
  }

  const note = await postNote({ wallet, chain, text, color });
  return NextResponse.json({ note });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  const wallet = typeof body?.wallet === "string" ? body.wallet : "";
  if (!isAdminWallet(wallet)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  if (!id) {
    return NextResponse.json({ error: "Missing note id." }, { status: 400 });
  }
  const ok = await deleteNote(id);
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
    return NextResponse.json({ error: "Missing note id." }, { status: 400 });
  }
  const ok = await setNotePinned(id, pinned);
  return NextResponse.json({ ok });
}
