// Windows-95-styled meme cards featuring Dyl (the Crypto Rich Deluxe cover
// character), rendered once per chain in that chain's real colorway (see
// lib/albums.ts CHAINS) so a Robinhood-chain fan and a Base fan each get a
// version that matches their chain. Generated as real PNGs at
// public/memes/<chainKey>/<slug>.png — this file is just the caption data
// (real, crawlable text — the images themselves aren't readable by search
// engines) plus which visual mode/character each one uses.
export interface Meme {
  slug: string;
  headline: string;
  subtext: string;
  mode: "normal" | "dialog" | "pixel";
  character: boolean;
}

export const MEMES: Meme[] = [
  {
    slug: "onchain-music-is-back",
    headline: "Onchain Music Is Back.",
    subtext: "Dyl Music NFTs — stream free, own it for $0.99.",
    mode: "normal",
    character: true,
  },
  {
    slug: "099-mints",
    headline: "$0.99 Mints.",
    subtext: "Music NFTs are back. Only 100 per song.",
    mode: "normal",
    character: true,
  },
  {
    slug: "mint-a-song",
    headline: "Mint A Song For $0.99",
    subtext: "Crypto Rich — the OG crypto rap album.",
    mode: "normal",
    character: true,
  },
  {
    slug: "save-music-nfts",
    headline: "I'm Here To Save Music NFTs.",
    subtext: "The Dyl dApp — real songs, real ownership.",
    mode: "dialog",
    character: true,
  },
  {
    slug: "dyl-dapp",
    headline: "The Dyl dApp.",
    subtext: "An onchain music dApp. Not a metaphor — an actual one.",
    mode: "normal",
    character: true,
  },
  {
    slug: "099-music-nfts",
    headline: "$0.99 Music NFTs",
    subtext: "Only 100 per song. First come, first minted.",
    mode: "normal",
    character: true,
  },
  {
    slug: "streaming-app",
    headline: "A Music NFT Streaming App.",
    subtext: "Stream every track free. Own your favorite for $0.99.",
    mode: "normal",
    character: false,
  },
  {
    slug: "zero-fees",
    headline: "0% Fees. Forever.",
    subtext: "List your Music NFT free. Not even OpenSea can say that.",
    mode: "normal",
    character: false,
  },
  {
    slug: "four-chains",
    headline: "4 Chains. 1 Wallet.",
    subtext: "Robinhood, Base, Solana, Ethereum — mint anywhere.",
    mode: "normal",
    character: true,
  },
  {
    slug: "100-editions",
    headline: "100 Editions. Then Gone.",
    subtext: "No restock. No second drop. Ever.",
    mode: "normal",
    character: false,
  },
  {
    slug: "win95-energy",
    headline: "Windows 95 Energy.",
    subtext: "2026 tech. Retro vibes. Onchain Music dApp.",
    mode: "pixel",
    character: true,
  },
  {
    slug: "error-402",
    headline: "Error 402: Payment Required",
    subtext: "Just kidding. It's $0.99.",
    mode: "dialog",
    character: false,
  },
  {
    slug: "system-minted",
    headline: "System.exe Has Minted Successfully.",
    subtext: "Edition #47 of 100 — congratulations.",
    mode: "dialog",
    character: false,
  },
  {
    slug: "insert-99-cents",
    headline: "Insert $0.99",
    subtext: "To continue listening.",
    mode: "pixel",
    character: false,
  },
  {
    slug: "music-nfts-are-back",
    headline: "Music NFTs Are Back.",
    subtext: "And this time, the Dyl dApp actually works.",
    mode: "pixel",
    character: true,
  },
];
