import { Redis } from "@upstash/redis";

// Same Upstash pattern as lib/chatStore.ts/lib/siteListingsStore.ts — real
// buy/sell activity has to be visible across every visitor's browser, not
// just the one that performed it. Before this, lib/activity.ts's
// recordActivity/readRecentActivity was the ONLY activity tracking in the
// app, and it's pure per-browser localStorage — real buys never called it
// at all (only the simulated fallback paths did), and real sells called it
// but only ever showed up in the seller's own browser. The dashboard's
// "Recent Transactions" / "NFT Sales" stats were therefore never real for
// any visitor other than whoever's browser performed the action.

const ACTIVITY_KEY = "dylmusic:activity";
const MAX_ENTRIES = 500;

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export interface RealActivityEntry {
  id: string;
  type: "buy" | "sell";
  chain: string;
  wallet: string;
  trackTitle: string;
  editionNumber: number | null;
  priceUsd: number;
  txHash?: string;
  ts: number;
}

export function activityStoreConfigured(): boolean {
  return getRedis() !== null;
}

export async function recordRealActivity(entry: Omit<RealActivityEntry, "id" | "ts">): Promise<RealActivityEntry | null> {
  const redis = getRedis();
  if (!redis) return null;
  const full: RealActivityEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
  };
  await redis.lpush(ACTIVITY_KEY, JSON.stringify(full));
  await redis.ltrim(ACTIVITY_KEY, 0, MAX_ENTRIES - 1);
  return full;
}

export async function readRealActivity(limit = 100): Promise<RealActivityEntry[]> {
  const redis = getRedis();
  if (!redis) return [];
  const raw = await redis.lrange(ACTIVITY_KEY, 0, limit - 1);
  return raw
    .map((r) => {
      try {
        return typeof r === "string" ? (JSON.parse(r) as RealActivityEntry) : (r as unknown as RealActivityEntry);
      } catch {
        return null;
      }
    })
    .filter((e): e is RealActivityEntry => e !== null);
}
