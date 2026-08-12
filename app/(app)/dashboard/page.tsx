import type { Metadata } from "next";
import { CRYPTO_RICH_DELUXE } from "@/lib/albums";
import MultichainOverview from "@/components/MultichainOverview";

const TITLE = "Dashboard";
const DESCRIPTION =
  "Live stats for the Dyl dApp — mint volume, editions minted per chain, streaming numbers, and NFT sales, updated in real time.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: ["Music NFTs", "Onchain Music", "NFT sales", "Crypto", "Dyl dApp", "Onchain Music dApp"],
  openGraph: { title: `${TITLE} | Dyl`, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: `${TITLE} | Dyl`, description: DESCRIPTION },
};

export default function DashboardPage() {
  return <MultichainOverview album={CRYPTO_RICH_DELUXE} />;
}
