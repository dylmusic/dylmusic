import type { Track } from "./albums";
import type { OrderBookEntry } from "./orderbook";
import { getNativeTokenForChain } from "./dylTokens";
import { getTokenUsdPrice } from "./tokenUsdPrice";
import {
  fetchMagicEdenCollectionListings,
  resolveMagicEdenCollectionSymbol,
} from "./magicEdenListing";
import { fetchTrackMintProgress, fetchTrackGuardPriceLamports } from "./solanaAdmin";
import type { SolanaMintRecord } from "./solanaMintsStore";

// Real, merged order-book data for Solana — mirrors lib/realOrderBook.ts's
// EVM shape, but Solana's own real differences carry through rather than
// being papered over: mint progress/price are per-TRACK (one Candy
// Machine each, not one shared contract), and a listing's tokenMint has
// to be cross-referenced against our own recorded SolanaMintRecord[] to
// know which track/edition it even is (Magic Eden has no concept of this
// app's tokenId numbering).

export interface RealSolanaListing {
  source: "magiceden";
  trackId: number;
  editionNumber: number;
  mint: string;
  priceSol: number;
  priceUsd: number;
  sellerAddress: string;
  auctionHouse: string;
  expiry: number;
}

// Cached per session once resolved — a collection's Magic Eden symbol
// never changes once assigned, same reasoning as lib/realOrderBook.ts's
// OpenSea slug cache.
let cachedSymbol: string | null | undefined;

async function resolveSymbol(records: SolanaMintRecord[]): Promise<string | null> {
  if (cachedSymbol !== undefined) return cachedSymbol;
  if (records.length === 0) return null;
  cachedSymbol = await resolveMagicEdenCollectionSymbol(records[0].mint);
  return cachedSymbol;
}

async function fetchMintRecords(): Promise<SolanaMintRecord[]> {
  const res = await fetch("/api/solana-mints");
  const data = await res.json().catch(() => ({ mints: [] as SolanaMintRecord[] }));
  return data?.mints ?? [];
}

/** Real, merged Magic Eden listings for the whole collection, cross-referenced against our own recorded mints to know which track/edition each one is. */
export async function fetchRealSolanaListings(): Promise<RealSolanaListing[]> {
  const records = await fetchMintRecords();
  const symbol = await resolveSymbol(records);
  if (!symbol) return [];

  const solToken = getNativeTokenForChain("solana");
  const solUsd = (await getTokenUsdPrice(solToken)) ?? 0;

  const meListings = await fetchMagicEdenCollectionListings(symbol);
  const byMint = new Map(records.map((r) => [r.mint, r]));
  const out: RealSolanaListing[] = [];
  for (const l of meListings) {
    const record = byMint.get(l.tokenMint);
    if (!record) continue; // not one of our tracked editions — skip rather than guess which track it belongs to
    out.push({
      source: "magiceden",
      trackId: record.trackId,
      editionNumber: record.editionNumber,
      mint: l.tokenMint,
      priceSol: l.priceSol,
      priceUsd: l.priceSol * solUsd,
      sellerAddress: l.seller,
      auctionHouse: l.auctionHouse,
      expiry: l.expiry,
    });
  }
  return out;
}

export interface RealSolanaMintRow {
  priceSol: number;
  priceUsd: number;
  remaining: number;
}

/** Real on-chain mint progress + LIVE guard price for one track — null if this track has no recorded Candy Machine yet (never minted on Solana). */
export async function fetchRealSolanaMintRow(track: Track, records: SolanaMintRecord[]): Promise<RealSolanaMintRow | null> {
  const record = records.find((r) => r.trackId === track.index);
  if (!record) return null;
  const progress = await fetchTrackMintProgress(record.candyMachine);
  const remaining = progress.itemsAvailable - progress.itemsRedeemed;
  if (remaining <= 0) return { priceSol: 0, priceUsd: 0, remaining: 0 };
  if (!record.candyGuard) return null; // pre-guard-wrap state (shouldn't be reachable post-mint, but real data could be mid-way through a run)
  const priceLamports = await fetchTrackGuardPriceLamports(record.candyGuard);
  if (priceLamports === null) return null;
  const priceSol = priceLamports / 1_000_000_000;
  const solToken = getNativeTokenForChain("solana");
  const solUsd = (await getTokenUsdPrice(solToken)) ?? 0;
  return { priceSol, priceUsd: priceSol * solUsd, remaining };
}

/** Combines the real mint row + real merged listings for ONE track into the same OrderBookEntry[] shape the EVM/simulated versions produce. */
export async function buildRealSolanaOrderBook(
  track: Track,
  records: SolanaMintRecord[],
  allListings: RealSolanaListing[]
): Promise<OrderBookEntry[]> {
  const entries: OrderBookEntry[] = [];
  const mintRow = await fetchRealSolanaMintRow(track, records);
  if (mintRow && mintRow.remaining > 0) {
    entries.push({ type: "mint", priceUsd: mintRow.priceUsd, remaining: mintRow.remaining });
  }
  for (const l of allListings) {
    if (l.trackId !== track.index) continue;
    entries.push({
      type: "resale",
      priceUsd: l.priceUsd,
      editionNumber: l.editionNumber,
      seller: l.sellerAddress,
      source: "magiceden",
      sellerAddress: l.sellerAddress,
      tokenId: undefined, // Solana has no EVM-style tokenId — l.mint (in raw) is the real identifier
      raw: l,
    });
  }
  return entries.sort((a, b) => a.priceUsd - b.priceUsd);
}

export { fetchMintRecords };
