"use client";

import { ChainKey } from "./albums";

// Local-only ledger for this prototype — no chain has a real deployed
// contract yet, so mints/sales are simulated in the browser via
// localStorage. Swapping this for real on-chain reads/writes later doesn't
// need to change the UI layer, just these functions.
//
// Two separate stores on purpose: MINTS (who actually owns an edition) and
// LISTINGS (a demo ask price on a track). Listings deliberately don't
// require a prior mint — the Buy/Sell pair is shown on every track so the
// marketplace mechanic is demonstrable before real ownership exists.

export interface HoldingRecord {
  editionNumber: number;
}

type HoldingsMap = Record<string, HoldingRecord>;
type ListingsMap = Record<string, number>;
// key = `${chainKey}:${walletLower}:${trackId}`

const MINTS_KEY = "dylmusic_holdings_v1";
const LISTINGS_KEY = "dylmusic_listings_v1";

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

export function getHolding(
  chainKey: ChainKey,
  wallet: string,
  trackId: string
): HoldingRecord | undefined {
  return readMap<HoldingRecord>(MINTS_KEY)[key(chainKey, wallet, trackId)];
}

// Count of locally-recorded mints for a track on a chain, across whichever
// wallets have touched this browser — combined with the seeded baseline to
// produce the "x/100" number shown in the UI.
export function localMintedCount(chainKey: ChainKey, trackId: string): number {
  const all = readMap<HoldingRecord>(MINTS_KEY);
  const prefix = `${chainKey}:`;
  const suffix = `:${trackId}`;
  let n = 0;
  for (const k of Object.keys(all)) {
    if (k.startsWith(prefix) && k.endsWith(suffix)) n++;
  }
  return n;
}

export function recordMint(
  chainKey: ChainKey,
  wallet: string,
  trackId: string,
  editionNumber: number
) {
  const all = readMap<HoldingRecord>(MINTS_KEY);
  all[key(chainKey, wallet, trackId)] = { editionNumber };
  writeMap(MINTS_KEY, all);
}

export function getListingPrice(
  chainKey: ChainKey,
  wallet: string,
  trackId: string
): number | undefined {
  return readMap<number>(LISTINGS_KEY)[key(chainKey, wallet, trackId)];
}

export function setListingPrice(
  chainKey: ChainKey,
  wallet: string,
  trackId: string,
  priceUsd: number | null
) {
  const all = readMap<number>(LISTINGS_KEY);
  const k = key(chainKey, wallet, trackId);
  if (priceUsd == null) {
    delete all[k];
  } else {
    all[k] = priceUsd;
  }
  writeMap(LISTINGS_KEY, all);
}
