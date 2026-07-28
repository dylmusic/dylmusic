import { NextRequest, NextResponse } from "next/server";
import { checkSolanaWallet } from "@/lib/solanaCollectionCheck";

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address")?.trim();
  if (!address) {
    return NextResponse.json({ error: "Missing address." }, { status: 400 });
  }
  const result = await checkSolanaWallet(address);
  return NextResponse.json(result);
}
