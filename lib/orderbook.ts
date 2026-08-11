"use client";

import { ChainKey, Track, baselineMinted } from "./albums";
import { getAllListings, localMintedCount } from "./holdings";

export interface OrderBookEntry {
  type: "mint" | "resale";
  priceUsd: number;
  // present only for "resale" entries
  editionNumber?: number;
  seller?: string;
  // present only for the "mint" entry
  remaining?: number;
  // Real-listing metadata (lib/realOrderBook.ts / lib/realSolanaOrderBook.ts)
  // — absent for simulated entries (every chain, until it's actually
  // deployed). Additive only, so every existing consumer of this type that
  // only reads the fields above keeps working untouched.
  source?: "site" | "opensea" | "magiceden";
  chainId?: number;
  collectionAddress?: string;
  tokenId?: number;
  sellerAddress?: string;
  /** The exact object the matching fulfill call needs for this source — a StoredListing, an OpenSea Listing, or a Magic Eden listing record. */
  raw?: unknown;
}

// While the track hasn't sold out, minting a fresh edition at face value is
// always an option alongside whatever's been listed for resale — combine
// both into one sorted book, cheapest first. Once minted === cap, there's no
// more "mint" row and it's pure secondary market, same as any real
// marketplace once primary supply runs out.
export function buildOrderBook(track: Track, chain: ChainKey): OrderBookEntry[] {
  const minted = Math.min(
    track.editionCap,
    baselineMinted(track, chain) + localMintedCount(chain, track.id)
  );
  const remaining = track.editionCap - minted;

  const entries: OrderBookEntry[] = [];
  if (remaining > 0) {
    entries.push({ type: "mint", priceUsd: track.priceUsd, remaining });
  }

  for (const ask of getAllListings(chain, track.id)) {
    entries.push({
      type: "resale",
      priceUsd: ask.priceUsd,
      editionNumber: ask.editionNumber,
      seller: ask.wallet,
    });
  }

  return entries.sort((a, b) => a.priceUsd - b.priceUsd);
}

export function floorEntry(track: Track, chain: ChainKey): OrderBookEntry | null {
  const book = buildOrderBook(track, chain);
  return book[0] ?? null;
}
