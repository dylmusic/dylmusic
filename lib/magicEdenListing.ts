import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import type { PhantomProvider } from "./solana";

// Magic Eden is the real target for Solana secondary listings (Dylan's own
// call — see dylmusic/CLAUDE.md's "our own marketplace contract" section:
// "Magic Eden is the real target there, not OpenSea"). Confirmed live
// against Magic Eden's own published API docs (docs.magiceden.io) before
// writing any of this, same discipline already used for lib/openSeaListing.ts:
//
// - Base URL https://api-mainnet.magiceden.dev/v2, every instruction
//   endpoint requires a Bearer API key (free tier exists but is a
//   form-gated signup, not instant self-serve — same category of external
//   credential as NEXT_PUBLIC_OPENSEA_API_KEY / WALLETCONNECT_PROJECT_ID).
// - GET /instructions/sell — seller, tokenMint, tokenAccount, price (SOL,
//   decimal, NOT lamports) → an UNSIGNED transaction (raw bytes).
// - GET /instructions/sell_change_price — seller, tokenMint, tokenAccount,
//   price (current), newPrice, expiry → an unsigned transaction that
//   updates the EXISTING listing in place. This is the real mechanism
//   behind "Reprice & Relist" here — unlike the EVM side (Seaport orders
//   have no native reprice, so that flow has to cancel + re-sign from
//   scratch), Magic Eden's own Auction House supports changing price
//   directly, no cancel needed first.
// - GET /instructions/sell_cancel — seller, tokenMint, tokenAccount, price
//   → an unsigned transaction that cancels the listing.
// - Every one of these returns raw transaction bytes, not something Umi
//   understands — these get built/signed as plain @solana/web3.js
//   Transactions (Phantom's signTransaction already speaks that format
//   natively), a different signing path from lib/solanaAdmin.ts's Umi
//   instructions.
//
// Never exercised end-to-end (no API key obtained yet, no funded wallet in
// this environment) — every param name/shape/endpoint above was read
// directly from Magic Eden's own docs, not guessed.

const ME_API_BASE = "https://api-mainnet.magiceden.dev/v2";

function getMagicEdenApiKey(): string {
  const key = process.env.NEXT_PUBLIC_MAGIC_EDEN_API_KEY;
  if (!key) {
    throw new Error(
      "NEXT_PUBLIC_MAGIC_EDEN_API_KEY is not set — request one at docs.magiceden.io and add it to the environment before listing on Magic Eden."
    );
  }
  return key;
}

async function fetchMeTransaction(path: string, params: Record<string, string | number>): Promise<Transaction> {
  const apiKey = getMagicEdenApiKey();
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])));
  const res = await fetch(`${ME_API_BASE}${path}?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`Magic Eden API error (${res.status}) on ${path}: ${await res.text().catch(() => res.statusText)}`);
  }
  const body = (await res.json()) as { tx: { data: number[] } };
  return Transaction.from(Buffer.from(body.tx.data));
}

async function signAndSend(provider: PhantomProvider, connection: Connection, tx: Transaction): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  const signed = await provider.signTransaction(tx);
  const signature = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  return signature;
}

async function tokenAccountFor(mint: string, owner: string): Promise<string> {
  const ata = await getAssociatedTokenAddress(new PublicKey(mint), new PublicKey(owner));
  return ata.toString();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export interface MeListingInput {
  mint: string;
  priceSol: number;
}

/** Lists each mint fresh (no existing listing assumed). Sequential with a small delay between calls, per Magic Eden's own batching guidance. */
export async function listEditionsOnMagicEden(
  provider: PhantomProvider,
  connection: Connection,
  seller: string,
  items: MeListingInput[],
  onProgress?: (done: number, total: number) => void
): Promise<{ successful: string[]; failed: Array<{ mint: string; error: Error }> }> {
  const successful: string[] = [];
  const failed: Array<{ mint: string; error: Error }> = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      const tokenAccount = await tokenAccountFor(item.mint, seller);
      const tx = await fetchMeTransaction("/instructions/sell", { seller, tokenMint: item.mint, tokenAccount, price: item.priceSol });
      const sig = await signAndSend(provider, connection, tx);
      successful.push(sig);
    } catch (err) {
      failed.push({ mint: item.mint, error: err instanceof Error ? err : new Error(String(err)) });
    }
    onProgress?.(i + 1, items.length);
    await sleep(300);
  }
  return { successful, failed };
}

export interface MeRepriceInput {
  mint: string;
  currentPriceSol: number;
  newPriceSol: number;
}

/** Changes price on an EXISTING listing in place — no cancel needed, this is Magic Eden's own native reprice instruction. */
export async function repriceEditionsOnMagicEden(
  provider: PhantomProvider,
  connection: Connection,
  seller: string,
  items: MeRepriceInput[],
  onProgress?: (done: number, total: number) => void
): Promise<{ successful: string[]; failed: Array<{ mint: string; error: Error }> }> {
  const successful: string[] = [];
  const failed: Array<{ mint: string; error: Error }> = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      const tokenAccount = await tokenAccountFor(item.mint, seller);
      const tx = await fetchMeTransaction("/instructions/sell_change_price", {
        seller,
        tokenMint: item.mint,
        tokenAccount,
        price: item.currentPriceSol,
        newPrice: item.newPriceSol,
        expiry: 0,
      });
      const sig = await signAndSend(provider, connection, tx);
      successful.push(sig);
    } catch (err) {
      failed.push({ mint: item.mint, error: err instanceof Error ? err : new Error(String(err)) });
    }
    onProgress?.(i + 1, items.length);
    await sleep(300);
  }
  return { successful, failed };
}

export interface MeCancelInput {
  mint: string;
  priceSol: number;
}

export async function cancelEditionsOnMagicEden(
  provider: PhantomProvider,
  connection: Connection,
  seller: string,
  items: MeCancelInput[],
  onProgress?: (done: number, total: number) => void
): Promise<{ successful: string[]; failed: Array<{ mint: string; error: Error }> }> {
  const successful: string[] = [];
  const failed: Array<{ mint: string; error: Error }> = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      const tokenAccount = await tokenAccountFor(item.mint, seller);
      const tx = await fetchMeTransaction("/instructions/sell_cancel", { seller, tokenMint: item.mint, tokenAccount, price: item.priceSol });
      const sig = await signAndSend(provider, connection, tx);
      successful.push(sig);
    } catch (err) {
      failed.push({ mint: item.mint, error: err instanceof Error ? err : new Error(String(err)) });
    }
    onProgress?.(i + 1, items.length);
    await sleep(300);
  }
  return { successful, failed };
}
