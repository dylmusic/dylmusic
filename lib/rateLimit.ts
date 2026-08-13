import { Redis } from "@upstash/redis";

// Same per-file getRedis() convention as every other *Store.ts in this
// codebase (lib/chatStore.ts etc.) rather than a shared singleton.
function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Simple fixed-window per-key rate limit (Redis INCR + EXPIRE-on-first-hit).
 * Guards routes that do real, expensive external work per request (paginated
 * Blockscout/TzKT calls, up to 1000 sequential Solana RPC calls in
 * lib/burnVerify.ts's verifySolanaDylBurnedAmount) — those aren't protected
 * by needing a real earned credit the way voucher-issuance is, so a scripted
 * loop hitting them repeatedly has nothing else stopping it from running up
 * real function-duration and outbound-RPC usage. Fails OPEN if Redis isn't
 * configured — same best-effort trust level as every other Redis-optional
 * feature here, not treated as a hard security boundary.
 */
export async function checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);
  return count <= limit;
}
