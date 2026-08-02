import type { Metadata } from "next";
import SwapCard from "@/components/SwapCard";

const TITLE = "Swap";
const DESCRIPTION =
  "Swap any token or memecoin cross-chain for $Dyl on Robinhood Chain, Base, Ethereum, or Solana — Web3 crypto swaps, no bridge required.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: ["Web3", "Crypto", "Memecoins", "cross-chain swap", "$Dyl"],
  openGraph: { title: `${TITLE} | Dyl`, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: `${TITLE} | Dyl`, description: DESCRIPTION },
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
