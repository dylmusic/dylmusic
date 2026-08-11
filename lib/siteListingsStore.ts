import { Redis } from "@upstash/redis";
import type { StoredListing } from "./siteListing";

// Same Upstash pattern as lib/chatStore.ts — our own site's resale
// listings (the 0%-fee Seaport orders, signed client-side in the admin
// panel) need to be visible across every visitor's browser, so this is the
// one server-side store for them. A hash per chain, keyed by tokenId, so a
// single edition's listing can be read/overwritten directly without
// rewriting the whole set (unlike the chat list, this doesn't need
// ordering — just "is this token currently listed, and for how much").

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function listingsKey(chainId: number): string {
  return `dylmusic:listings:${chainId}`;
}

export async function saveSiteListings(listings: StoredListing[]): Promise<boolean> {
  const redis = getRedis();
  if (!redis || listings.length === 0) return false;
  // Group by chain since each chain's listings live in their own hash.
  const byChain = new Map<number, StoredListing[]>();
  for (const l of listings) {
    if (!byChain.has(l.chainId)) byChain.set(l.chainId, []);
    byChain.get(l.chainId)!.push(l);
  }
  for (const [chainId, group] of byChain) {
    const fields: Record<string, string> = {};
    for (const l of group) fields[String(l.tokenId)] = JSON.stringify(l);
    await redis.hset(listingsKey(chainId), fields);
  }
  return true;
}

export async function getSiteListingsForChain(chainId: number): Promise<StoredListing[]> {
  const redis = getRedis();
  if (!redis) return [];
  const all = await redis.hgetall<Record<string, string>>(listingsKey(chainId));
  if (!all) return [];
  return Object.values(all)
    .map((raw) => {
      try {
        return typeof raw === "string" ? (JSON.parse(raw) as StoredListing) : (raw as unknown as StoredListing);
      } catch {
        return null;
      }
    })
    .filter((l): l is StoredListing => l !== null);
}

/** Removes one edition's stored listing after it's actually sold — without this, a fulfilled site listing would keep showing as available forever (nothing else ever hdel's this hash field). */
export async function removeSiteListing(chainId: number, tokenId: number): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  await redis.hdel(listingsKey(chainId), String(tokenId));
  return true;
}

export async function getSiteListing(chainId: number, tokenId: number): Promise<StoredListing | null> {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.hget<string>(listingsKey(chainId), String(tokenId));
  if (!raw) return null;
  try {
    return typeof raw === "string" ? (JSON.parse(raw) as StoredListing) : (raw as unknown as StoredListing);
  } catch {
    return null;
  }
}
