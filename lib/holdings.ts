"use client";

import { ChainKey } from "./albums";

// Local-only ledger for this prototype — no chain has a real deployed
// contract yet, so mints/sales are simulated in the browser via
// localStorage. Swapping this for real on-chain reads/writes later doesn't
// need to change the UI layer, just these functions.
//
// A wallet can own MULTIPLE numbered editions of the same track (buying
// twice gets you two different edition numbers), so ownership is an array,
// and each owned edition can carry its own independent listing price —
// that's what lets someone hold 10 editions and ask a different price for
// each one.

type MintsMap = Record<string, number[]>;
// key = `${chainKey}:${walletLower}:${trackId}` -> array of edition numbers owned

type ListingsMap = Record<string, Record<number, number>>;
// key = `${chainKey}:${walletLower}:${trackId}` -> { [editionNumber]: priceUsd }

const MINTS_KEY = "dylmusic_holdings_v2";
const LISTINGS_KEY = "dylmusic_listings_v2";

function readMap<T>(storageKey: string): Record<string, T> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as Record<string, T>) : {};
  } catch {
    return {};
  }
}

function writeMap<T>(storageKey: string, map: Record<string, T>) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(map));
  } catch {
    // ignore — non-critical for a demo ledger
  }
}

function key(chainKey: ChainKey, wallet: string, trackId: string) {
  return `${chainKey}:${wallet.toLowerCase()}:${trackId}`;
}

export function getOwnedEditions(
  chainKey: ChainKey,
  wallet: string,
  trackId: string
): number[] {
  return readMap<number[]>(MINTS_KEY)[key(chainKey, wallet, trackId)] ?? [];
}

// Count of locally-recorded mints for a track on a chain, across whichever
// wallets have touched this browser — combined with the seeded baseline to
// produce the "x/100" number shown in the UI.
export function localMintedCount(chainKey: ChainKey, trackId: string): number {
  const all = readMap<number[]>(MINTS_KEY);
  const prefix = `${chainKey}:`;
  const suffix = `:${trackId}`;
  let n = 0;
  for (const k of Object.keys(all)) {
    if (k.startsWith(prefix) && k.endsWith(suffix)) n += all[k].length;
  }
  return n;
}

export function recordMint(
  chainKey: ChainKey,
  wallet: string,
  trackId: string,
  editionNumber: number
) {
  const all = readMap<number[]>(MINTS_KEY);
  const k = key(chainKey, wallet, trackId);
  all[k] = [...(all[k] ?? []), editionNumber];
  writeMap(MINTS_KEY, all);
}

export function getListings(
  chainKey: ChainKey,
  wallet: string,
  trackId: string
): Record<number, number> {
  return readMap<Record<number, number>>(LISTINGS_KEY)[key(chainKey, wallet, trackId)] ?? {};
}

export function setListingForEdition(
  chainKey: ChainKey,
  wallet: string,
  trackId: string,
  editionNumber: number,
  priceUsd: number | null
) {
  const all = readMap<Record<number, number>>(LISTINGS_KEY);
  const k = key(chainKey, wallet, trackId);
  const current = { ...(all[k] ?? {}) };
  if (priceUsd == null) {
    delete current[editionNumber];
  } else {
    current[editionNumber] = priceUsd;
  }
  all[k] = current;
  writeMap(LISTINGS_KEY, all);
}

export interface ResaleAsk {
  wallet: string;
  editionNumber: number;
  priceUsd: number;
}

// Every active resale ask for a track on a chain, across every wallet that's
// touched this browser — this is the "order book" once you look past a
// single wallet's own listings.
export function getAllListings(chainKey: ChainKey, trackId: string): ResaleAsk[] {
  const all = readMap<Record<number, number>>(LISTINGS_KEY);
  const prefix = `${chainKey}:`;
  const suffix = `:${trackId}`;
  const asks: ResaleAsk[] = [];
  for (const k of Object.keys(all)) {
    if (!k.startsWith(prefix) || !k.endsWith(suffix)) continue;
    const wallet = k.slice(prefix.length, k.length - suffix.length);
    for (const [editionStr, priceUsd] of Object.entries(all[k])) {
      asks.push({ wallet, editionNumber: Number(editionStr), priceUsd });
    }
  }
  return asks.sort((a, b) => a.priceUsd - b.priceUsd);
}

// Buying a specific listed edition off another wallet: moves the edition
// out of the seller's holding into the buyer's, and clears the listing.
// Distinct from recordMint — this never touches the mint/edition-cap count,
// it's a transfer of an edition that already exists.
export function buyListedEdition(
  chainKey: ChainKey,
  trackId: string,
  seller: string,
  buyer: string,
  editionNumber: number
) {
  const mints = readMap<number[]>(MINTS_KEY);
  const sellerKey = key(chainKey, seller, trackId);
  const buyerKey = key(chainKey, buyer, trackId);

  mints[sellerKey] = (mints[sellerKey] ?? []).filter((e) => e !== editionNumber);
  mints[buyerKey] = [...(mints[buyerKey] ?? []), editionNumber];
  writeMap(MINTS_KEY, mints);

  const listings = readMap<Record<number, number>>(LISTINGS_KEY);
  const sellerListings = { ...(listings[sellerKey] ?? {}) };
  delete sellerListings[editionNumber];
  listings[sellerKey] = sellerListings;
  writeMap(LISTINGS_KEY, listings);
}
