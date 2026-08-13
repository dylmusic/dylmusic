"use client";

import { Album, CHAINS, ChainInfo } from "./albums";
import { fetchRealChainMinted } from "./realOrderBook";
import { CONTRACT_TARGETS } from "./admin";

export interface SoldStat {
  minted: number;
  cap: number;
  pct: number;
}

export interface PlatformOverview {
  perChain: { chain: ChainInfo; stat: SoldStat }[];
  totalMinted: number;
  totalCap: number;
  totalPct: number;
}

/**
 * Real platform-wide mint stats — one on-chain read per chain (parallel),
 * real zero for a chain with no deployed contract. Replaces the old
 * `platformOverview`/`chainSold`/`trackSold`, which computed this ENTIRELY
 * from simulated baseline+localStorage data for every chain, Robinhood
 * included — caught live showing "817 NFTs minted" against a real count
 * of 190. Volume is intentionally NOT computed here — see
 * lib/dashboardStats.ts's real activity-feed-derived volume instead, which
 * reflects actual reported transactions rather than a mint-count multiply.
 */
export async function fetchRealPlatformOverview(album: Album): Promise<PlatformOverview> {
  const perChain = await Promise.all(
    CHAINS.map(async (chain) => {
      const { minted, cap } = await fetchRealChainMinted(chain.key, album.tracks);
      return { chain, stat: { minted, cap, pct: cap === 0 ? 0 : (minted / cap) * 100 } };
    })
  );
  const totalMinted = perChain.reduce((sum, c) => sum + c.stat.minted, 0);
  const totalCap = perChain.reduce((sum, c) => sum + c.stat.cap, 0);
  return {
    perChain,
    totalMinted,
    totalCap,
    totalPct: totalCap === 0 ? 0 : (totalMinted / totalCap) * 100,
  };
}

/**
 * Real distinct-holder count, straight from Blockscout's own token endpoint
 * (`holders_count`) — Robinhood Chain only, the one chain with a real
 * deployed collection today (same "Robinhood is the only chain that's ever
 * real+nonempty" rule fetchRealPlatformOverview above already follows).
 * Real zero on a fetch failure rather than throwing and blanking the whole
 * dashboard — this is a "nice to have" stat, not load-bearing.
 */
export async function fetchRealHoldersCount(): Promise<number> {
  const address = CONTRACT_TARGETS.find((t) => t.key === "robinhood")?.address;
  if (!address) return 0;
  try {
    const res = await fetch(`https://robinhoodchain.blockscout.com/api/v2/tokens/${address}`);
    if (!res.ok) return 0;
    const data = await res.json();
    return Number(data?.holders_count) || 0;
  } catch {
    return 0;
  }
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

// Real historical trading volume from Dyl's pre-v2 collections, as given
// directly by Dylan — not derived from anything else in this codebase, and
// not the same thing as this v2 platform's own on-chain volume above.
// Kept in their original units and only converted to USD here (using the
// same display-only rate above) so it can be added to the platform's own
// USD-denominated volume for the "Total Volume" dashboard toggle.
const HISTORICAL_VOLUME_ETH = 21.32 + 43.59 + 3.3; // 3 old ETH collections
const HISTORICAL_VOLUME_USD = 70_000 + 6_000 + 500_000; // Solana + Tezos + $Dyl coin

export function historicalVolumeUsd(): number {
  return HISTORICAL_VOLUME_ETH * USD_PER_ETH + HISTORICAL_VOLUME_USD;
}
