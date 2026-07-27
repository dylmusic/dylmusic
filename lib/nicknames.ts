"use client";

// Per-wallet display name, set by the wallet's own owner, stored locally.
// Same local-only tradeoff as the rest of this prototype's ledger — no
// backend yet, so a nickname set in one browser only shows in that browser.

const STORAGE_KEY = "dylmusic_nicknames_v1";

function readAll(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, string>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export function getNickname(wallet: string): string | undefined {
  return readAll()[wallet.toLowerCase()];
}

export function setNickname(wallet: string, name: string | null) {
  const all = readAll();
  const key = wallet.toLowerCase();
  if (!name || !name.trim()) {
    delete all[key];
  } else {
    all[key] = name.trim().slice(0, 24);
  }
  writeAll(all);
}
