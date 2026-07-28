import type { Metadata } from "next";
import SwapCard from "@/components/SwapCard";

export const metadata: Metadata = {
  title: "Swap",
  description:
    "Swap any token cross-chain for $Dyl or any curated token on Robinhood Chain, Base, Ethereum, or Solana.",
};

export default function SwapPage() {
  return (
    <div className="dash-wrap">
      <div className="dash-page-head">
        <div className="dash-eyebrow">Swap</div>
        <h1>Dyl Swap</h1>
        <p className="swap-page-sub">Swap Any Token Cross-Chain</p>
      </div>
      <SwapCard />
    </div>
  );
}
