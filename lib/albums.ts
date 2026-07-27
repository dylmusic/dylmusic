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
  audioSrc: string;
  // Deterministic baseline so the demo doesn't look dead on first load —
  // real minted counts will come from indexing each chain once contracts exist.
  baselineMintedSeed: number;
}

export interface Album {
  slug: string;
  title: string;
  artist: string;
  year: number;
  coverImage: string;
  tracks: Track[];
}

function track(index: number, title: string, priceUsd = 5): Track {
  return {
    id: `track-${index}`,
    index,
    title,
    priceUsd,
    editionCap: 100,
    audioSrc: `/audio/track-${index}.mp3`,
    baselineMintedSeed: index,
  };
}

export const CRYPTO_RICH_DELUXE: Album = {
  slug: "crypto-rich-deluxe",
  title: "Crypto Rich (Deluxe)",
  artist: "dyl",
  year: 2020,
  coverImage: "/covers/crypto-rich-deluxe.jpg",
  // Real 19-track tracklist, in official release order (verified via Spotify).
  tracks: [
    track(1, "My Life"),
    track(2, "Little Bitty"),
    track(3, "Bad Hair"),
    track(4, "Way Back"),
    track(5, "Suck It"),
    track(6, "On Fire (feat. Wes Walker, Cus Paq)"),
    track(7, "Shooting Star"),
    track(8, "Sunday Scaries (feat. Cus Paq, Chex)"),
    track(9, "Murder Me"),
    track(10, "No Sleep"),
    track(11, "Treat Myself"),
    track(12, "Cryptocurrency"),
    track(13, "Big Facts"),
    track(14, "Flash Drive"),
    track(15, "Bitcoin"),
    track(16, "Blockchain"),
    track(17, "Ethereum"),
    track(18, "Aliens"),
    track(19, "Crypto Rich"),
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
