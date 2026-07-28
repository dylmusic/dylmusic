"use client";

import { useEffect, useState } from "react";
import { Track } from "./albums";

// Real, server-tracked play counts (Redis via /api/streams — see
// lib/streamsStore.ts) — replaced the old per-browser localStorage +
// deterministic-pseudo-random baseline entirely. Every play, from
// anywhere a track can be started (MiniPlayer, the /music track list,
// the homepage console preview, a desktop-icon click — they all funnel
// through PlayerContext's one toggleTrack, which is the single call site
// for recordStream below), increments the real shared counter starting
// from zero.

let counts: Record<string, number> = {};
let loaded = false;
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function ensureLoaded(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = fetch("/api/streams", { cache: "no-store" })
    .then((r) => r.json())
    .then((data) => {
      counts = data.counts ?? {};
      loaded = true;
      notify();
    })
    .catch(() => {
      loaded = true;
    });
  return loadPromise;
}

// Call once from any component that displays stream counts — triggers the
// initial fetch and re-renders that component when real data lands.
// Reading getStreamCount() without ever calling this just shows 0s.
export function useStreamCountsLoaded(): boolean {
  const [, forceRender] = useState(0);
  useEffect(() => {
    if (loaded) return;
    ensureLoaded().then(() => forceRender((n) => n + 1));
  }, []);
  return loaded;
}

export function getStreamCount(track: Track): number {
  return counts[track.id] ?? 0;
}

export function recordStream(track: Track) {
  // Optimistic local bump so the number that's currently on screen moves
  // immediately, same tolerance the rest of this prototype's telemetry
  // uses — the real number is whatever /api/streams returns next load.
  counts[track.id] = (counts[track.id] ?? 0) + 1;
  notify();
  fetch("/api/streams", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trackId: track.id }),
  }).catch(() => {
    // best-effort — same tolerance as the rest of this prototype's telemetry
  });
}

export function formatStreams(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}
