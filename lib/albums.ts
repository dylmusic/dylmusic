// Everything here is intentionally just data — swap art, prices, or add a new
// album without touching any UI code. Real tracklist/art/audio links go here
// when ready; these are placeholders so the concept can be demoed now.

export type ChainKey = "base" | "robinhood" | "solana" | "ethereum";

export interface ChainInfo {
  key: ChainKey;
  label: string;
  shortLabel: string;
  color: string;
  live: boolean;
}

// Ethereum added 2026-07-28 (Dylan: "gas is so low now, I think we should
// allow people to mint there... nothing to lose") — a muted purple-grey
// rather than Ethereum's usual saturated blue-purple brand color
// (#627EEA), since Base already owns blue in this palette and a
// near-identical hue next to it would read as a mistake, not a 4th
// distinct chain. Reads as a calmer, more "established chain" tone next
// to Robinhood's neon green / Base's electric blue / Solana's vivid
// purple, deliberately distinct from all three.
export const CHAINS: ChainInfo[] = [
  { key: "robinhood", label: "Robinhood", shortLabel: "Robinhood", color: "#CCFF00", live: true },
  { key: "base", label: "Base", shortLabel: "Base", color: "#0052FF", live: true },
  { key: "solana", label: "Solana", shortLabel: "Solana", color: "#9945FF", live: true },
  { key: "ethereum", label: "Ethereum", shortLabel: "Ethereum", color: "#8B8FA8", live: true },
];

export interface Track {
  id: string;
  index: number;
  title: string;
  priceUsd: number;
  editionCap: number;
  audioSrc: string;
  // No longer used for minted-count seeding (see baselineMinted below) —
  // still used as the seed for the unrelated fake stream-count in
  // lib/streams.ts, so kept rather than removed.
  baselineMintedSeed: number;
}

export interface Album {
  slug: string;
  title: string;
  artist: string;
  year: number;
  coverImage: string;
  tracks: Track[];
  comingSoon?: boolean;
}

function track(index: number, title: string, priceUsd = 0.99): Track {
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
  artist: "Dyl",
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

export const INTERNET_LEGEND: Album = {
  slug: "internet-legend",
  title: "Internet Legend",
  artist: "Dyl",
  year: 2022,
  coverImage: "/covers/internet-legend.jpg",
  tracks: [],
  comingSoon: true,
};

export const LOST_ANGELES_FILES: Album = {
  slug: "lost-angeles-files",
  title: "lost angeles files",
  artist: "Dyl",
  year: 2025,
  coverImage: "/covers/lost-angeles-files.png",
  tracks: [],
  comingSoon: true,
};

export const ALBUMS: Album[] = [CRYPTO_RICH_DELUXE, INTERNET_LEGEND, LOST_ANGELES_FILES];

// Deployment plan (CLAUDE.md "Deployment minting strategy"): editions #1-10
// of every song are auto-minted (and auto-listed for resale) at launch time
// on every chain, priced by rarity ($10 down to $100) — public mints start
// at #11. So the real starting state, before a single public sale, is a
// flat 10 minted out of each track's 100-edition cap, everywhere — not a
// random "looks alive" number. Same value on every chain since the mint
// plan itself doesn't vary by chain; `chainKey` is unused but kept so
// call sites don't need to change if that ever stops being true.
export function baselineMinted(track: Track, _chainKey: ChainKey): number {
  const PRE_MINTED_EDITIONS = 10;
  return Math.min(track.editionCap, PRE_MINTED_EDITIONS);
}
