import type { Metadata } from "next";
import MusicPageClient from "./music-client";

const TITLE = "Music";
const DESCRIPTION =
  "The Music NFT Streaming App — stream Dyl's discography free, then mint a song for $0.99. $0.99 Music NFTs, 100 editions each, on Robinhood Chain, Base, Ethereum, or Solana.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "Music NFTs",
    "Onchain Music",
    "NFTs",
    "Web3 Music",
    "NFT music collector",
    "$0.99 Music NFTs",
    "Music NFT Streaming App",
    "Mint A Song For $0.99",
  ],
  openGraph: { title: `${TITLE} | Dyl`, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: `${TITLE} | Dyl`, description: DESCRIPTION },
};

export default function MusicPage() {
  return <MusicPageClient />;
}
