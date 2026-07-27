"use client";

import { Track } from "./albums";

// Same "seeded baseline + local increments" pattern as minted counts —
// streams aren't on-chain, just a play-count metric. A real backend counter
// (e.g. incrementing in Redis on each `onPlay`) is the natural next step;
// this keeps the number believable and consistent per track in the
// meantime instead of starting every track at a dead-looking zero.

const STORAGE_KEY = "dylmusic_streams_v1";

function baselineStreams(track: Track): number {
  // Deterministic pseudo-random spread roughly in the 400–9,000 range.
  const seed = track.baselineMintedSeed;
  const n = ((seed * 9301 + 49297) % 8600) + 400;
  return n;
}

function readAll(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, number>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export function getStreamCount(track: Track): number {
  const local = readAll()[track.id] ?? 0;
  return baselineStreams(track) + local;
}

export function recordStream(track: Track) {
  const all = readAll();
  all[track.id] = (all[track.id] ?? 0) + 1;
  writeAll(all);
}

export function formatStreams(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}
