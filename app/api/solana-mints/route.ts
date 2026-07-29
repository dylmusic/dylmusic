import { NextRequest, NextResponse } from "next/server";
import { saveSolanaMints, getAllSolanaMints, type SolanaMintRecord } from "@/lib/solanaMintsStore";
import { isAdminWallet } from "@/lib/admin";

// Persists which editions deployTrackAndMintAdmin (lib/solanaAdmin.ts)
// actually minted to the admin wallet — same "gate writes on the EVM admin
// wallet, since that's what /admin itself is already gated on, reads are
// public" split as app/api/listings/route.ts. The `wallet` field here is
// always the connected EVM admin wallet (ADMIN_WALLET), never a Solana
// address — Solana has no signature-based auth wired into this route,
// consistent with how the rest of /admin's write endpoints work today.

export async function GET() {
  const mints = await getAllSolanaMints();
  return NextResponse.json({ mints });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const wallet = typeof body?.wallet === "string" ? body.wallet : "";
  const mints = Array.isArray(body?.mints) ? (body.mints as SolanaMintRecord[]) : [];
  if (!isAdminWallet(wallet)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  if (mints.length === 0) {
    return NextResponse.json({ error: "No mints provided." }, { status: 400 });
  }
  const ok = await saveSolanaMints(mints);
  return NextResponse.json({ ok });
}
