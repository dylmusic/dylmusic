import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount, TokenAccountNotFoundError, TokenInvalidAccountOwnerError } from "@solana/spl-token";
import { saveSolanaMints, getAllSolanaMints, type SolanaMintRecord } from "@/lib/solanaMintsStore";
import { isAdminWallet } from "@/lib/admin";

// Persists which editions map to which real mint address. Originally
// admin-only (deployTrackAndMintAdmin's own premint records); opened up
// (2026-08-11) so a real public mintV2 purchase (lib/solanaPurchase.ts
// fulfillSolanaMintPurchase) can record itself too — without this, a
// publicly-minted edition has no way to be found/resold later (Magic
// Eden has no concept of our own trackId/editionNumber numbering).
//
// Deliberately NOT the same self-reported trust model as EVM's
// /api/listings POST (which only checks the submitted wallet matches the
// listing's own seller) — a wrong Solana record would corrupt the
// track/edition <-> mint mapping for EVERY future visitor who reads it,
// not just the submitter's own view, and there's no per-token "seller"
// field here that keeps a bad write scoped to itself. Guarded instead
// with a real on-chain read: only accepted once the submitted wallet's
// own Associated Token Account genuinely holds that mint right now — a
// TokenAccountNotFoundError there just means "no ATA yet" (a normal
// zero-balance state, not an error), same handling lib/solana.ts's own
// getSolanaBalance already uses.
//
// Admin's own premint writes (still isAdminWallet-gated in
// app/admin/page.tsx's own flow) bypass this on-chain check — admin mints
// straight to itself in the same instruction, so there's no meaningful
// "prove it" step beyond what already happened on-chain seconds earlier;
// requiring a fresh RPC read there would just be a slower version of the
// same trust already implicit in "this wallet is the site's own admin."

const SOLANA_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://solana-rpc.publicnode.com";

async function walletHoldsMint(wallet: string, mint: string): Promise<boolean> {
  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  try {
    const ata = await getAssociatedTokenAddress(new PublicKey(mint), new PublicKey(wallet));
    const account = await getAccount(connection, ata);
    return account.amount > BigInt(0);
  } catch (err) {
    if (err instanceof TokenAccountNotFoundError || err instanceof TokenInvalidAccountOwnerError) return false;
    throw err;
  }
}

export async function GET() {
  const mints = await getAllSolanaMints();
  return NextResponse.json({ mints });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const wallet = typeof body?.wallet === "string" ? body.wallet : "";
  const mints = Array.isArray(body?.mints) ? (body.mints as SolanaMintRecord[]) : [];
  if (!wallet) {
    return NextResponse.json({ error: "Missing wallet." }, { status: 400 });
  }
  if (mints.length === 0) {
    return NextResponse.json({ error: "No mints provided." }, { status: 400 });
  }

  if (!isAdminWallet(wallet)) {
    for (const m of mints) {
      const holds = await walletHoldsMint(wallet, m.mint);
      if (!holds) {
        return NextResponse.json(
          { error: `Wallet does not currently hold mint ${m.mint} — refusing to record it.` },
          { status: 403 }
        );
      }
    }
  }

  const ok = await saveSolanaMints(mints);
  return NextResponse.json({ ok });
}
