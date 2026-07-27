"use client";

import { ChainKey } from "./albums";

export type ActivityType = "buy" | "sell";

export interface ActivityEntry {
  id: string;
  type: ActivityType;
  chain: ChainKey;
  wallet: string;
  trackTitle: string;
  editionNumber: number | null;
  priceUsd: number;
  ts: number;
}

const STORAGE_KEY = "dylmusic_activity_v1";
const MAX_ENTRIES = 60;

function readAll(): ActivityEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ActivityEntry[]) : [];
  } catch {
    return [];
  }
}

export function recordActivity(entry: Omit<ActivityEntry, "id" | "ts">) {
  const all = readAll();
  all.unshift({
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
  });
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all.slice(0, MAX_ENTRIES)));
  } catch {
    // ignore
  }
}

export function readRecentActivity(limit = 10): ActivityEntry[] {
  return readAll().slice(0, limit);
}
