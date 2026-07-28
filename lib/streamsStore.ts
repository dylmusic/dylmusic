import { Redis } from "@upstash/redis";

// Same Upstash pattern as lib/chatStore.ts / lib/boardStore.ts — real,
// server-side play counts instead of the old per-browser localStorage +
// deterministic-pseudo-random baseline. Dylan: "wire it up to track every
// single stream... start tracking the streams now... this will be the
// start of the real running stream count." So this starts at zero for
// every track, no seeded/blended baseline — whatever's in Redis IS the
// real count from here forward.

const STREAMS_KEY = "dylmusic:streams:counts";

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export async function incrementStream(trackId: string): Promise<number | null> {
  const redis = getRedis();
  if (!redis) return null;
  return redis.hincrby(STREAMS_KEY, trackId, 1);
}

export async function readStreamCounts(): Promise<Record<string, number>> {
  const redis = getRedis();
  if (!redis) return {};
  const raw = await redis.hgetall<Record<string, unknown>>(STREAMS_KEY);
  if (!raw) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    // Same Upstash gotcha as lib/stats.ts in the sibling hoodprinter
    // project — numeric-looking hash values can come back auto-parsed as
    // numbers already, or as strings; coerce either way.
    const n = typeof v === "number" ? v : Number(v);
    out[k] = Number.isFinite(n) ? n : 0;
  }
  return out;
}

export function streamsConfigured(): boolean {
  return getRedis() !== null;
}
