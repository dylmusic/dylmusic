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

/**
 * Resolves the collection SYMBOL (the {symbol} path param every
 * /collections/{symbol}/... endpoint needs) from any one real mint we
 * already know about — GET /tokens/{mint} (public, no key, verified live
 * against docs.magiceden.io) returns a `collection` field. **Real, flagged
 * unknown, not fully confirmed**: Magic Eden's own docs describe this
 * field only as "the collection identifier," not explicitly as the same
 * string used in the {symbol} path param elsewhere — needs a live check
 * once a real mint exists (same category of caveat already recorded for
 * OpenSea's own collection-slug resolution in lib/realOrderBook.ts).
 */
export async function resolveMagicEdenCollectionSymbol(anyKnownMint: string): Promise<string | null> {
  const res = await fetch(`${ME_API_BASE}/tokens/${anyKnownMint}`);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return typeof data?.collection === "string" ? data.collection : null;
}

export interface MeListing {
  tokenMint: string;
  seller: string;
  priceSol: number;
  auctionHouse: string;
  expiry: number;
}

/**
 * Public, no API key — GET /collections/{symbol}/listings, verified live
 * against docs.magiceden.io (2026-08-11): every active listing for the
 * WHOLE collection (anyone's, not just ones listed through /admin),
 * paginated via offset/limit (max 100/page). Pairs with a
 * SolanaMintRecord lookup (lib/solanaMintsStore.ts) to map a returned
 * tokenMint back to a trackId/editionNumber — Magic Eden has no concept
 * of this app's own numbering scheme, only the real mint address.
 */
export async function fetchMagicEdenCollectionListings(symbol: string): Promise<MeListing[]> {
  const all: MeListing[] = [];
  const LIMIT = 100;
  for (let offset = 0; ; offset += LIMIT) {
    const res = await fetch(`${ME_API_BASE}/collections/${encodeURIComponent(symbol)}/listings?offset=${offset}&limit=${LIMIT}`);
    if (!res.ok) {
      throw new Error(`Magic Eden API error (${res.status}) fetching collection listings: ${await res.text().catch(() => res.statusText)}`);
    }
    const page = (await res.json()) as Array<{ tokenMint: string; seller: string; price: number; auctionHouse: string; expiry: number }>;
    all.push(...page.map((p) => ({ tokenMint: p.tokenMint, seller: p.seller, priceSol: p.price, auctionHouse: p.auctionHouse, expiry: p.expiry })));
    if (page.length < LIMIT) break;
  }
  return all;
}

export interface MeBuyInput {
  buyer: string;
  seller: string;
  tokenMint: string;
  priceSol: number;
  sellerExpiry: number;
}

/**
 * Real resale purchase — GET /instructions/buy_now (Bearer auth, verified
 * live against docs.magiceden.io: required params buyer/seller/tokenMint/
 * tokenATA/price/sellerExpiry). `priceSol`/`sellerExpiry` must exactly
 * match the seller's live listing (fetchMagicEdenCollectionListings'
 * output) — Auction House needs the real current terms, not a guess.
 */
export async function fulfillMagicEdenPurchase(
  provider: PhantomProvider,
  connection: Connection,
  input: MeBuyInput
): Promise<string> {
  const tokenATA = await tokenAccountFor(input.tokenMint, input.seller);
  const tx = await fetchMeTransaction("/instructions/buy_now", {
    buyer: input.buyer,
    seller: input.seller,
    tokenMint: input.tokenMint,
    tokenATA,
    price: input.priceSol,
    sellerExpiry: input.sellerExpiry,
  });
  return signAndSend(provider, connection, tx);
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
