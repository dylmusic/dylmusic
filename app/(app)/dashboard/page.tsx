import type { Metadata } from "next";
import { CRYPTO_RICH_DELUXE } from "@/lib/albums";
import MultichainOverview from "@/components/MultichainOverview";

export const metadata: Metadata = {
  title: "Dashboard",
  description:
    "Live stats for Dyl's Music NFTs — mint volume, editions minted per chain, streaming numbers, and NFT sales, updated in real time.",
};

export default function DashboardPage() {
  return <MultichainOverview album={CRYPTO_RICH_DELUXE} />;
}
