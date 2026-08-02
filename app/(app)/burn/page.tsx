import type { Metadata } from "next";
import BurnPageClient from "./burn-client";

const TITLE = "Burn Old NFTs & $Dyl Coin";
const DESCRIPTION =
  "Burn your old Dyl NFTs and $Dyl memecoin across Ethereum, Solana, and Tezos to earn free mints on the new onchain Music NFTs platform.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: ["Burn NFTs", "Memecoins", "$Dyl", "NFTs", "Crypto"],
  openGraph: { title: `${TITLE} | Dyl`, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: `${TITLE} | Dyl`, description: DESCRIPTION },
};

export default function BurnPage() {
  return <BurnPageClient />;
}
