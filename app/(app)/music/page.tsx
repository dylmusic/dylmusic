import type { Metadata } from "next";
import MusicPageClient from "./music-client";

export const metadata: Metadata = {
  title: "Music",
  description:
    "Browse Dyl's discography — stream every track and collect numbered onchain Music NFT editions on Robinhood Chain, Base, Ethereum, or Solana.",
};

export default function MusicPage() {
  return <MusicPageClient />;
}
