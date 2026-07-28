import { Redis } from "@upstash/redis";

// Same Upstash pattern as the sibling hoodprinter project — free tier,
// REST-based, no persistent connection to manage. Every other piece of
// "ownership" in this app lives in the browser's own localStorage (no real
// contracts deployed yet), but a chat has to be visible across different
// people's browsers, so this is the one feature that genuinely needs a
// server-side store.

const CHAT_KEY = "dylmusic:chat:messages";
const MAX_MESSAGES = 200;

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export interface ChatMessage {
  id: string;
  wallet: string;
  chain: string;
  text: string;
  ts: number;
  pinned?: boolean;
}

export async function postMessage(msg: Omit<ChatMessage, "id" | "ts">): Promise<ChatMessage | null> {
  const redis = getRedis();
  if (!redis) return null;
  const entry: ChatMessage = {
    ...msg,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
  };
  await redis.lpush(CHAT_KEY, JSON.stringify(entry));
  await redis.ltrim(CHAT_KEY, 0, MAX_MESSAGES - 1);
  return entry;
}

// Pinned messages first (newest-pinned first), then everything else
// newest-first — same list, just re-ordered on read so a pin doesn't need
// its own separate key/store.
export async function readMessages(limit = 100): Promise<ChatMessage[]> {
  const redis = getRedis();
  if (!redis) return [];
  const raw = await redis.lrange(CHAT_KEY, 0, limit - 1);
  const parsed = raw
    .map((r) => {
      try {
        return typeof r === "string" ? (JSON.parse(r) as ChatMessage) : (r as unknown as ChatMessage);
      } catch {
        return null;
      }
    })
    .filter((m): m is ChatMessage => m !== null)
    .reverse();
  const pinned = parsed.filter((m) => m.pinned);
  const rest = parsed.filter((m) => !m.pinned);
  return [...pinned, ...rest];
}

// Admin moderation — the list has no per-item key to target, so this reads
// the whole thing, drops the one entry, and rewrites it in the same
// newest-first order the original lpush calls built.
export async function deleteMessage(id: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  const raw = await redis.lrange(CHAT_KEY, 0, -1);
  const kept = raw.filter((r) => {
    try {
      const parsed = typeof r === "string" ? (JSON.parse(r) as ChatMessage) : (r as unknown as ChatMessage);
      return parsed.id !== id;
    } catch {
      return true;
    }
  });
  if (kept.length === raw.length) return false;
  await redis.del(CHAT_KEY);
  if (kept.length > 0) await redis.rpush(CHAT_KEY, ...kept);
  return true;
}

// Admin-only: mark/unmark a message as pinned. Same read-modify-rewrite
// approach as deleteMessage, since there's no per-item key.
export async function setMessagePinned(id: string, pinned: boolean): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  const raw = await redis.lrange(CHAT_KEY, 0, -1);
  let found = false;
  const next: string[] = [];
  for (const r of raw) {
    try {
      const parsed = typeof r === "string" ? (JSON.parse(r) as ChatMessage) : (r as unknown as ChatMessage);
      if (parsed.id === id) {
        found = true;
        next.push(JSON.stringify({ ...parsed, pinned }));
      } else {
        next.push(JSON.stringify(parsed));
      }
    } catch {
      // skip unparseable entries rather than risk corrupting the rewrite
    }
  }
  if (!found) return false;
  await redis.del(CHAT_KEY);
  if (next.length > 0) await redis.rpush(CHAT_KEY, ...next);
  return true;
}

export function chatConfigured(): boolean {
  return getRedis() !== null;
}
