"use client";

import { useState } from "react";
import { LEGACY_ASSETS, LegacyAsset } from "@/lib/legacyCollections";
import BurnWalletChecker from "@/components/BurnWalletChecker";
import SolanaWalletChecker from "@/components/SolanaWalletChecker";
import TezosWalletChecker from "@/components/TezosWalletChecker";

function truncate(addr: string, head = 8, tail = 6) {
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

function AssetRow({ asset }: { asset: LegacyAsset }) {
  return (
    <div className="burn-row">
      <div className="burn-row-info">
        <div className="burn-row-head">
          <span className="burn-row-chain">{asset.chainLabel}</span>
          <span className={`burn-row-kind burn-row-kind-${asset.kind}`}>
            {asset.kind === "nft" ? "NFT" : "TOKEN"}
          </span>
        </div>
        <div className="burn-row-name">{asset.name}</div>
        <div className="burn-row-addr">
          {truncate(asset.address)}
          {asset.tokenId && <> · id {truncate(asset.tokenId, 6, 4)}</>}
          {asset.note && <span className="burn-row-note"> · {asset.note}</span>}
        </div>
      </div>
      <button className="burn-row-btn" disabled title="Not live yet">
        Burn
      </button>
    </div>
  );
}

export default function BurnPage() {
  const [showContracts, setShowContracts] = useState(false);

  return (
    <div className="dash-wrap">
      <div className="dash-page-head">
        <div className="dash-eyebrow">Burn</div>
        <h1>Burn Old NFTs &amp; $Dyl Coin</h1>
        <p className="swap-page-sub">
          Do you have Dyl NFTs or $Dyl? Burn it here to join the new ecosystem for free.
        </p>
      </div>

      <div className="burn-notice">
        Burning isn&apos;t live yet, but you can check your free mints now.
      </div>

      <div className="burn-checkers">
        <BurnWalletChecker />
        <SolanaWalletChecker />
        <TezosWalletChecker />
      </div>

      <button
        className="burn-contracts-toggle"
        onClick={() => setShowContracts((v) => !v)}
      >
        {showContracts ? "▲ Hide" : "▼ View"} every eligible contract ({LEGACY_ASSETS.length})
      </button>

      {showContracts && (
        <div className="burn-list">
          {LEGACY_ASSETS.map((a) => (
            <AssetRow key={`${a.chain}-${a.address}-${a.tokenId ?? ""}-${a.kind}`} asset={a} />
          ))}
        </div>
      )}
    </div>
  );
}
