"use client";

import { Album, CHAINS, ChainKey, Track, baselineMinted } from "./albums";
import { localMintedCount } from "./holdings";

export interface SoldStat {
  minted: number;
  cap: number;
  pct: number;
}

export function trackSold(track: Track, chain: ChainKey): SoldStat {
  const minted = Math.min(
    track.editionCap,
    baselineMinted(track, chain) + localMintedCount(chain, track.id)
  );
  return { minted, cap: track.editionCap, pct: (minted / track.editionCap) * 100 };
}

export function chainSold(album: Album, chain: ChainKey): SoldStat {
  let minted = 0;
  let cap = 0;
  for (const t of album.tracks) {
    const s = trackSold(t, chain);
    minted += s.minted;
    cap += s.cap;
  }
  return { minted, cap, pct: cap === 0 ? 0 : (minted / cap) * 100 };
}

export interface PlatformOverview {
  perChain: { chain: (typeof CHAINS)[number]; stat: SoldStat }[];
  totalMinted: number;
  totalCap: number;
  totalPct: number;
  totalVolumeUsd: number;
}

export function platformOverview(album: Album): PlatformOverview {
  const perChain = CHAINS.map((chain) => ({ chain, stat: chainSold(album, chain.key) }));
  const totalMinted = perChain.reduce((sum, c) => sum + c.stat.minted, 0);
  const totalCap = perChain.reduce((sum, c) => sum + c.stat.cap, 0);

  // Real dollar-weighted volume (not just a mint count) — sums each track's
  // own priceUsd × how many editions of it are minted, per chain. No real
  // payment has ever actually happened (see CLAUDE.md), so this is the same
  // "looks real, seeded from the same baseline mint data" number every other
  // platform stat already is, not a claim of real settled revenue.
  let totalVolumeUsd = 0;
  for (const chain of CHAINS) {
    for (const t of album.tracks) {
      totalVolumeUsd += trackSold(t, chain.key).minted * t.priceUsd;
    }
  }

  return {
    perChain,
    totalMinted,
    totalCap,
    totalPct: totalCap === 0 ? 0 : (totalMinted / totalCap) * 100,
    totalVolumeUsd,
  };
}

// Rough, display-only conversion rates — not a live price feed. Good enough
// for a "quick stats" ETH/SOL toggle, not meant to be exact.
const USD_PER_ETH = 3400;
const USD_PER_SOL = 180;

export function usdToEth(usd: number): number {
  return usd / USD_PER_ETH;
}

export function usdToSol(usd: number): number {
  return usd / USD_PER_SOL;
}
