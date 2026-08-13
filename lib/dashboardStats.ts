"use client";

import { Album } from "./albums";
import { getStreamCount } from "./streams";
import type { RealActivityEntry } from "./activityStore";

const DAYS = 14;

function seededRand(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

export interface DayPoint {
  label: string;
  value: number;
}

function dayLabel(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

// Synthetic-but-stable 14-day trend ending at today's real total — same
// "seeded so it never looks dead" approach as baselineMinted/baselineStreams.
// Not real historical data (nothing persists day-over-day without a
// backend), but a believable shape for the chart.
export function streamsSeries(album: Album): { series: DayPoint[]; total: number; topTrack: string; topCount: number } {
  const total = album.tracks.reduce((sum, t) => sum + getStreamCount(t), 0);
  let topTrack = album.tracks[0].title;
  let topCount = 0;
  for (const t of album.tracks) {
    const c = getStreamCount(t);
    if (c > topCount) {
      topCount = c;
      topTrack = t.title;
    }
  }

  const weights: number[] = [];
  let wSum = 0;
  for (let i = 0; i < DAYS; i++) {
    const w = 0.6 + seededRand(i * 7.13 + 1) * 0.9;
    weights.push(w);
    wSum += w;
  }
  const series: DayPoint[] = weights.map((w, i) => ({
    label: dayLabel(DAYS - 1 - i),
    value: Math.round((w / wSum) * total),
  }));
  // make sure "today" reflects the real live total most directly
  series[series.length - 1].value = Math.max(
    series[series.length - 1].value,
    Math.round(total / DAYS)
  );

  return { series, total, topTrack, topCount };
}

export interface SalesDayPoint {
  label: string;
  buys: number;
  sells: number;
}

export interface RealSalesStats {
  series: SalesDayPoint[];
  avgBuyPrice: number;
  avgSellPrice: number;
  buysToday: number;
  sellsToday: number;
  totalVolumeUsd: number;
  recent: RealActivityEntry[];
}

export const EMPTY_SALES_STATS: RealSalesStats = {
  series: Array.from({ length: DAYS }, (_, i) => ({ label: dayLabel(DAYS - 1 - i), buys: 0, sells: 0 })),
  avgBuyPrice: 0,
  avgSellPrice: 0,
  buysToday: 0,
  sellsToday: 0,
  totalVolumeUsd: 0,
  recent: [],
};

/**
 * Real sales stats — replaces the old salesSeries()'s seeded-random 14-day
 * trend (a fake shape "so it never looks dead," with only THIS browser's
 * own local activity folded into "today"). Sourced entirely from
 * /api/activity, the real cross-visitor buy/sell log (see
 * lib/activityStore.ts). Days before real launch, or with no real
 * activity, correctly show 0 — that's the honest truth for a platform that
 * just went live, not a limitation to work around with a fake shape.
 */
// Returns `null` (not EMPTY_SALES_STATS) when the fetch itself failed —
// a network error or bad response is a different fact than "the API really
// has zero activity records," and conflating them was the same class of bug
// fixed in fetchRealFullSetHolders/fetchRealHoldersCount above: a transient
// failure would overwrite the cached (and possibly real, non-zero) volume
// with a fake empty result. `null` tells the caller to leave the last
// cached value alone instead.
export async function fetchRealSalesStats(): Promise<RealSalesStats | null> {
  const res = await fetch("/api/activity?limit=500").catch(() => null);
  if (!res || !res.ok) return null;
  const data = await res.json().catch(() => null);
  if (data === null) return null;
  const activity: RealActivityEntry[] = data?.activity ?? [];
  if (activity.length === 0) return EMPTY_SALES_STATS; // genuinely fetched, genuinely empty — a real zero

  const now = new Date();
  const todayKey = now.toDateString();
  const dayKeys: string[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dayKeys.push(d.toDateString());
  }
  const series: SalesDayPoint[] = dayKeys.map((key, i) => {
    const dayActivity = activity.filter((a) => new Date(a.ts).toDateString() === key);
    return {
      label: dayLabel(DAYS - 1 - i),
      buys: dayActivity.filter((a) => a.type === "buy").length,
      sells: dayActivity.filter((a) => a.type === "sell").length,
    };
  });

  const todayActivity = activity.filter((a) => new Date(a.ts).toDateString() === todayKey);
  const buyPrices = activity.filter((a) => a.type === "buy").map((a) => a.priceUsd);
  const sellPrices = activity.filter((a) => a.type === "sell").map((a) => a.priceUsd);

  return {
    series,
    avgBuyPrice: buyPrices.length ? buyPrices.reduce((s, p) => s + p, 0) / buyPrices.length : 0,
    avgSellPrice: sellPrices.length ? sellPrices.reduce((s, p) => s + p, 0) / sellPrices.length : 0,
    buysToday: todayActivity.filter((a) => a.type === "buy").length,
    sellsToday: todayActivity.filter((a) => a.type === "sell").length,
    totalVolumeUsd: buyPrices.reduce((s, p) => s + p, 0),
    recent: activity.slice(0, 12),
  };
}
