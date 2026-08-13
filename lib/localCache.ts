// Tiny stale-while-revalidate helper for on-chain-derived numbers that are
// otherwise slow (real RPC/indexer reads) and would flash "0" or "Loading…"
// on every page load. Read the last-known-good value from localStorage as
// the initial render, kick off the real fetch in the background, and
// write-through once it resolves — the UI never regresses to a worse state
// than what it already showed the user, it just gets fresher in place.
//
// Deliberately dumb (no TTL/expiry, no invalidation) — a stale real number
// (e.g. yesterday's mint count) is always a strictly better first paint than
// 0, and every call site here re-fetches the real value on mount anyway, so
// staleness is bounded by "one background fetch," never shown for long.

const PREFIX = "dylmusic:cache:";

function safeLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Safari private mode / disabled storage — fail closed to "no cache"
    // rather than throw and break the real fetch this is only meant to help.
    return null;
  }
}

export function readCachedNumber(key: string): number | null {
  const ls = safeLocalStorage();
  if (!ls) return null;
  const raw = ls.getItem(PREFIX + key);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function writeCachedNumber(key: string, value: number): void {
  const ls = safeLocalStorage();
  if (!ls || !Number.isFinite(value)) return;
  try {
    ls.setItem(PREFIX + key, String(value));
  } catch {
    // Quota exceeded or similar — silently drop, this is a nice-to-have.
  }
}

export function readCachedJson<T>(key: string): T | null {
  const ls = safeLocalStorage();
  if (!ls) return null;
  const raw = ls.getItem(PREFIX + key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeCachedJson<T>(key: string, value: T): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  try {
    ls.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota exceeded or similar — silently drop.
  }
}
