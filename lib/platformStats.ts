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
}

export function platformOverview(album: Album): PlatformOverview {
  const perChain = CHAINS.map((chain) => ({ chain, stat: chainSold(album, chain.key) }));
  const totalMinted = perChain.reduce((sum, c) => sum + c.stat.minted, 0);
  const totalCap = perChain.reduce((sum, c) => sum + c.stat.cap, 0);
  return {
    perChain,
    totalMinted,
    totalCap,
    totalPct: totalCap === 0 ? 0 : (totalMinted / totalCap) * 100,
  };
}
