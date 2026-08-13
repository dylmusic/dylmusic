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
 * Returns `null` on a fetch failure rather than a fake `0` — a transient
 * Blockscout hiccup is not the same fact as "genuinely zero holders," and
 * the caller (MultichainOverview) leaves the last cached value on screen
 * when it sees `null` instead of overwriting a real cached number (and the
 * cache itself) with a false zero. This is a "nice to have" stat, not
 * load-bearing, so a failed read just means "try again next mount," not
 * "blank the dashboard."
 */
export async function fetchRealHoldersCount(): Promise<number | null> {
  const address = CONTRACT_TARGETS.find((t) => t.key === "robinhood")?.address;
  if (!address) return 0;
  try {
    const res = await fetch(`https://robinhoodchain.blockscout.com/api/v2/tokens/${address}`);
    if (!res.ok) return null;
    const data = await res.json();
    return Number(data?.holders_count) || 0;
  } catch {
    return null;
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
 * Real platform-wide audit: how many complete album sets have actually been
 * collected, total — not distinct-collector headcount. A wallet holding 10
 * editions of every track holds 10 complete sets, and counts as 10 here, not
 * 1 — this is what "Full Albums Collected" reads as to a visitor, and
 * matches how Dylan's own real holdings (10-13 editions of every track,
 * verified live) should show up: 10, not 1. (Originally built as a distinct-
 * wallet count per "how many wallets hold full album sets" — corrected once
 * that undercounted Dylan's own real holdings on the live dashboard: a
 * wallet with min(held per track) = 10 is 10 complete sets in one wallet,
 * not "1 collector.")
 *
 * Walks Blockscout's paginated `/tokens/{address}/instances` endpoint
 * (same real, no-API-key, CORS-open source lib/tieredCollectionCheck.ts
 * already proved out) once for the whole collection — every instance
 * comes back with its CURRENT owner inline, so this is one paginated
 * sweep rather than individual ownerOf() calls. Each instance's tokenId
 * decodes to a trackId via the same encoding scheme every mint/buy
 * already uses (lib/tokenIdScheme.ts) — tally how many editions of each
 * track every wallet holds, then for each wallet take the MINIMUM across
 * every track (the number of complete sets that wallet can assemble) and
 * sum that across all wallets.
 *
 * Returns `null` (not `0`) on any fetch failure — this walk makes several
 * sequential paginated requests to compute one number, so a single
 * transient Blockscout hiccup mid-sweep is real surface area, and treating
 * that the same as "genuinely zero complete sets" was exactly what caused
 * the dashboard tile to flash back to 0 on refresh: the failure got written
 * into both React state AND the localStorage cache, poisoning the "last
 * known good" value until the next successful run happened to overwrite it
 * again. `null` tells the caller "couldn't determine this time" so it
 * leaves the last real cached number on screen instead.
 */
export async function fetchRealFullSetHolders(album: Album): Promise<number | null> {
  const address = CONTRACT_TARGETS.find((t) => t.key === "robinhood")?.address;
  if (!address || album.tracks.length === 0) return 0;

  const heldPerTrack = new Map<number, Map<string, number>>();
  for (const t of album.tracks) heldPerTrack.set(t.index, new Map());

  let failed = false;
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
      if (!res.ok) {
        failed = true;
        break;
      }
      const page: BlockscoutInstancesPage = await res.json();
      for (const item of page.items) {
        const owner = item.owner?.hash?.toLowerCase();
        if (!owner) continue;
        const { trackId } = decodeTokenId(Number(item.id));
        const perWallet = heldPerTrack.get(trackId);
        if (!perWallet) continue;
        perWallet.set(owner, (perWallet.get(owner) ?? 0) + 1);
      }
      if (!page.next_page_params) break;
      params = page.next_page_params;
    }
  } catch {
    failed = true;
  }

  // A page genuinely failed mid-sweep — the maps built so far are a partial,
  // misleading picture (could read as a false 0 OR a false lower number
  // than reality), not a real result. Bail out with "couldn't determine"
  // rather than reporting whatever partial data happened to accumulate.
  if (failed) return null;

  const perTrackMaps = Array.from(heldPerTrack.values());
  if (perTrackMaps.some((m) => m.size === 0)) return 0; // every page succeeded and a track genuinely has zero holders — no set can be complete

  const allWallets = new Set<string>();
  for (const m of perTrackMaps) for (const w of m.keys()) allWallets.add(w);

  let totalCompleteSets = 0;
  for (const wallet of allWallets) {
    const min = Math.min(...perTrackMaps.map((m) => m.get(wallet) ?? 0));
    totalCompleteSets += min;
  }
  return totalCompleteSets;
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
