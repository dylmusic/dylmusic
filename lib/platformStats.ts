"use client";

import { Album, CHAINS, ChainInfo } from "./albums";
import { fetchRealChainMinted } from "./realOrderBook";
import { CONTRACT_TARGETS } from "./admin";
import { decodeTokenId } from "./tokenIdScheme";

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

interface BlockscoutOwnedInstance {
  id: string;
  owner?: { hash?: string | null } | null;
}

interface BlockscoutInstancesPage {
  items: BlockscoutOwnedInstance[];
  next_page_params: Record<string, string | number> | null;
}

/**
 * Real platform-wide audit: how many distinct wallets currently hold at
 * least one edition of EVERY track in the album — a genuine full-set
 * collector count, not a per-wallet "did I collect it" flag (Dylan: "a
 * platform wide audit of how many wallets hold full album sets").
 *
 * Walks Blockscout's paginated `/tokens/{address}/instances` endpoint
 * (same real, no-API-key, CORS-open source lib/tieredCollectionCheck.ts
 * already proved out) once for the whole collection — every instance
 * comes back with its CURRENT owner inline, so this is one paginated
 * sweep (real total here: ~204 instances, ~5 pages) rather than 200+
 * individual ownerOf() calls. Each instance's tokenId decodes to a
 * trackId via the same encoding scheme every mint/buy already uses
 * (lib/tokenIdScheme.ts) — group owners per track, then intersect every
 * track's owner set. A wallet only survives every intersection if it
 * owns at least one edition of all N tracks.
 *
 * Real zero on any fetch failure, same "don't blank the dashboard over a
 * nice-to-have stat" rule as fetchRealHoldersCount above.
 */
export async function fetchRealFullSetHolders(album: Album): Promise<number> {
  const address = CONTRACT_TARGETS.find((t) => t.key === "robinhood")?.address;
  if (!address || album.tracks.length === 0) return 0;

  const ownersByTrack = new Map<number, Set<string>>();
  for (const t of album.tracks) ownersByTrack.set(t.index, new Set());

  try {
    let params: Record<string, string | number> | null = {};
    for (;;) {
      const qs = new URLSearchParams(
        Object.fromEntries(Object.entries(params ?? {}).map(([k, v]) => [k, String(v)]))
      ).toString();
      const res = await fetch(
        `https://robinhoodchain.blockscout.com/api/v2/tokens/${address}/instances${qs ? `?${qs}` : ""}`,
        { cache: "no-store" }
      );
      if (!res.ok) break;
      const page: BlockscoutInstancesPage = await res.json();
      for (const item of page.items) {
        const owner = item.owner?.hash?.toLowerCase();
        if (!owner) continue;
        const { trackId } = decodeTokenId(Number(item.id));
        ownersByTrack.get(trackId)?.add(owner);
      }
      if (!page.next_page_params) break;
      params = page.next_page_params;
    }
  } catch {
    return 0;
  }

  const trackSets = Array.from(ownersByTrack.values());
  if (trackSets.some((s) => s.size === 0)) return 0; // at least one track has zero holders — no set can be complete
  let intersection = trackSets[0];
  for (let i = 1; i < trackSets.length && intersection.size > 0; i++) {
    const next = trackSets[i];
    intersection = new Set(Array.from(intersection).filter((w) => next.has(w)));
  }
  return intersection.size;
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
