import type { Metadata } from "next";
import MusicPageClient from "./music-client";

const TITLE = "Music";
const DESCRIPTION =
  "Browse Dyl's discography — stream every track and collect numbered onchain Music NFT editions on Robinhood Chain, Base, Ethereum, or Solana.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: `${TITLE} | Dyl`, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: `${TITLE} | Dyl`, description: DESCRIPTION },
};

export default function MusicPage() {
  return <MusicPageClient />;
}
