// Everything here is intentionally just data — swap art, prices, or add a new
// album without touching any UI code. Real tracklist/art/audio links go here
// when ready; these are placeholders so the concept can be demoed now.

export type ChainKey = "base" | "robinhood" | "solana";

export interface ChainInfo {
  key: ChainKey;
  label: string;
  shortLabel: string;
  color: string;
  live: boolean;
}

export const CHAINS: ChainInfo[] = [
  { key: "base", label: "Base", shortLabel: "BASE", color: "#0052FF", live: true },
  { key: "robinhood", label: "Robinhood Chain", shortLabel: "RH", color: "#00C805", live: true },
  { key: "solana", label: "Solana", shortLabel: "SOL", color: "#9945FF", live: true },
];

export interface Track {
  id: string;
  index: number;
  title: string;
  priceUsd: number;
  editionCap: number;
  // Deterministic baseline so the demo doesn't look dead on first load —
  // real minted counts will come from indexing each chain once contracts exist.
  baselineMintedSeed: number;
}

export interface Album {
  slug: string;
  title: string;
  artist: string;
  year: number;
  tracks: Track[];
}

function track(index: number, title: string, priceUsd = 0.99): Track {
  return {
    id: `track-${index}`,
    index,
    title,
    priceUsd,
    editionCap: 100,
    baselineMintedSeed: index,
  };
}

export const CRYPTO_RICH_DELUXE: Album = {
  slug: "crypto-rich-deluxe",
  title: "Crypto Rich (Deluxe)",
  artist: "dyl",
  year: 2021,
  tracks: [
    track(1, "Track 01"),
    track(2, "Track 02"),
    track(3, "Track 03"),
    track(4, "Track 04"),
    track(5, "Track 05"),
    track(6, "Track 06"),
    track(7, "Track 07"),
    track(8, "Track 08"),
  ],
};

export const ALBUMS: Album[] = [CRYPTO_RICH_DELUXE];

// Simple seeded pseudo-random baseline mint count per chain+track, stable
// across reloads without needing a backend. Purely cosmetic "this is live"
// texture for the prototype — replace with a real on-chain read later.
export function baselineMinted(track: Track, chainKey: ChainKey): number {
  const chainSalt = chainKey === "base" ? 11 : chainKey === "robinhood" ? 23 : 7;
  const n = (track.baselineMintedSeed * 37 + chainSalt * 13) % 41;
  return Math.min(track.editionCap - 1, n);
}
