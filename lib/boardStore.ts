import { Redis } from "@upstash/redis";

// Same Upstash pattern as lib/chatStore.ts — a public bulletin board instead
// of a scrolling log, so posts are read back newest-first and stay "pinned"
// (nothing ever auto-scrolls away, only trimmed at MAX_NOTES or removed by
// an admin) rather than functioning like a chat transcript.

const BOARD_KEY = "dylmusic:board:notes";
const MAX_NOTES = 300;

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export interface BoardNote {
  id: string;
  wallet: string;
  chain: string;
  text: string;
  ts: number;
}

export async function postNote(note: Omit<BoardNote, "id" | "ts">): Promise<BoardNote | null> {
  const redis = getRedis();
  if (!redis) return null;
  const entry: BoardNote = {
    ...note,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
  };
  await redis.lpush(BOARD_KEY, JSON.stringify(entry));
  await redis.ltrim(BOARD_KEY, 0, MAX_NOTES - 1);
  return entry;
}

export async function readNotes(limit = 300): Promise<BoardNote[]> {
  const redis = getRedis();
  if (!redis) return [];
  const raw = await redis.lrange(BOARD_KEY, 0, limit - 1);
  return raw
    .map((r) => {
      try {
        return typeof r === "string" ? (JSON.parse(r) as BoardNote) : (r as unknown as BoardNote);
      } catch {
        return null;
      }
    })
    .filter((n): n is BoardNote => n !== null);
}

export async function deleteNote(id: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  const raw = await redis.lrange(BOARD_KEY, 0, -1);
  const kept = raw.filter((r) => {
    try {
      const parsed = typeof r === "string" ? (JSON.parse(r) as BoardNote) : (r as unknown as BoardNote);
      return parsed.id !== id;
    } catch {
      return true;
    }
  });
  if (kept.length === raw.length) return false;
  await redis.del(BOARD_KEY);
  if (kept.length > 0) await redis.rpush(BOARD_KEY, ...kept);
  return true;
}

export function boardConfigured(): boolean {
  return getRedis() !== null;
}
