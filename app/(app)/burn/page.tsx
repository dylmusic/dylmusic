import type { Metadata } from "next";
import BurnPageClient from "./burn-client";

export const metadata: Metadata = {
  title: "Burn Old NFTs & $Dyl Coin",
  description:
    "Burn your old Dyl NFTs and $Dyl coin across Ethereum, Solana, and Tezos to earn free mints on the new onchain Music NFTs platform.",
};

export default function BurnPage() {
  return <BurnPageClient />;
}
