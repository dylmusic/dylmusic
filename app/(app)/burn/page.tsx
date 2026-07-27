"use client";

import { LEGACY_ASSETS, LegacyAsset } from "@/lib/legacyCollections";

function truncate(addr: string) {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
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
  return (
    <div className="dash-wrap">
      <div className="dash-page-head">
        <div className="dash-eyebrow">Burn</div>
        <h1>Burn Old NFTs &amp; $Dyl Coin</h1>
        <p className="swap-page-sub">
          Hold something from an old Dyl drop? Burn it here for a free mint on the new
          collection — once burning is actually live.
        </p>
      </div>

      <div className="burn-notice">
        Burning isn&apos;t wired up yet. It destroys a real asset permanently, and there&apos;s
        nothing real to mint back until the new collections are deployed — so this stays
        Coming Soon until that&apos;s true. This page already lists every old contract that will
        be eligible.
      </div>

      <div className="burn-list">
        {LEGACY_ASSETS.map((a) => (
          <AssetRow key={`${a.chain}-${a.address}-${a.kind}`} asset={a} />
        ))}
      </div>
    </div>
  );
}
