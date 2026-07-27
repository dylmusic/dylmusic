"use client";

import { Album } from "./albums";
import { getStreamCount } from "./streams";
import { readRecentActivity } from "./activity";

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

export function salesSeries(): {
  series: SalesDayPoint[];
  avgBuyPrice: number;
  avgSellPrice: number;
  buysToday: number;
  sellsToday: number;
} {
  const activity = readRecentActivity(60);

  const series: SalesDayPoint[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const seedBuys = 3 + Math.floor(seededRand(i * 3.7 + 11) * 14);
    const seedSells = 1 + Math.floor(seededRand(i * 5.2 + 23) * 6);
    series.push({ label: dayLabel(i), buys: seedBuys, sells: seedSells });
  }

  // fold in real local activity from this session into "today"
  const today = series[series.length - 1];
  const realBuys = activity.filter((a) => a.type === "buy").length;
  const realSells = activity.filter((a) => a.type === "sell").length;
  today.buys += realBuys;
  today.sells += realSells;

  const buyPrices = activity.filter((a) => a.type === "buy").map((a) => a.priceUsd);
  const sellPrices = activity.filter((a) => a.type === "sell").map((a) => a.priceUsd);
  const avgBuyPrice = buyPrices.length
    ? buyPrices.reduce((s, p) => s + p, 0) / buyPrices.length
    : 0.99;
  const avgSellPrice = sellPrices.length
    ? sellPrices.reduce((s, p) => s + p, 0) / sellPrices.length
    : 1.49;

  return {
    series,
    avgBuyPrice,
    avgSellPrice,
    buysToday: today.buys,
    sellsToday: today.sells,
  };
}
