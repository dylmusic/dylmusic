"use client";

import { ChainKey } from "./albums";

// Local-only holdings ledger for this prototype — no chain has a real
// deployed contract yet, so mints/sales are simulated in the browser via
// localStorage. Swapping this for real on-chain reads/writes later doesn't
// need to change the UI layer, just these functions.

export interface HoldingRecord {
  editionNumber: number;
  listedPriceUsd: number | null;
}

type HoldingsMap = Record<string, HoldingRecord>;
// key = `${chainKey}:${walletLower}:${trackId}`

const STORAGE_KEY = "dylmusic_holdings_v1";

function readAll(): HoldingsMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as HoldingsMap) : {};
  } catch {
    return {};
  }
}

function writeAll(map: HoldingsMap) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
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
  return readAll()[key(chainKey, wallet, trackId)];
}

// Count of locally-recorded mints for a track on a chain, across whichever
// wallets have touched this browser — combined with the seeded baseline to
// produce the "x/100" number shown in the UI.
export function localMintedCount(chainKey: ChainKey, trackId: string): number {
  const all = readAll();
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
  const all = readAll();
  all[key(chainKey, wallet, trackId)] = { editionNumber, listedPriceUsd: null };
  writeAll(all);
}

export function setListing(
  chainKey: ChainKey,
  wallet: string,
  trackId: string,
  priceUsd: number | null
) {
  const all = readAll();
  const k = key(chainKey, wallet, trackId);
  const existing = all[k];
  if (!existing) return;
  all[k] = { ...existing, listedPriceUsd: priceUsd };
  writeAll(all);
}
