import type { Metadata } from "next";
import MemesPageClient from "./memes-client";

const TITLE = "Memes";
const DESCRIPTION =
  "Free, downloadable Music NFT memes starring Dyl — Windows 95 style, one colorway per chain. Onchain music is back, music NFTs are back, and the Dyl dApp has the memes to prove it.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "Music NFTs",
    "Onchain Music",
    "Music NFTs are back",
    "Onchain music is back",
    "Dyl dApp",
    "Dyl Music NFTs",
    "$0.99 Music NFTs",
    "memes",
    "Windows 95",
  ],
  openGraph: {
    title: `${TITLE} | Dyl`,
    description: DESCRIPTION,
    images: ["/memes/robinhood/music-nfts-are-back.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: `${TITLE} | Dyl`,
    description: DESCRIPTION,
    images: ["/memes/robinhood/music-nfts-are-back.png"],
  },
};

export default function MemesPage() {
  return <MemesPageClient />;
}
