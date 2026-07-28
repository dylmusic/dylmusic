"use client";

import { useState } from "react";
import { LEGACY_ASSETS, LegacyAsset } from "@/lib/legacyCollections";
import BurnWalletChecker from "@/components/BurnWalletChecker";
import SolanaWalletChecker from "@/components/SolanaWalletChecker";
import TezosWalletChecker from "@/components/TezosWalletChecker";
import MintAllocator from "@/components/MintAllocator";

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

  // Each checker reports its own spendable total up here so the page can
  // show one combined number and plan a chain split against the real
  // grand total, not just whichever checker happens to have the allocator
  // built into it (see components/MintAllocator.tsx).
  const [evmSpendable, setEvmSpendable] = useState(0);
  const [solanaSpendable, setSolanaSpendable] = useState(0);
  const [tezosSpendable, setTezosSpendable] = useState(0);
  const totalSpendable = evmSpendable + solanaSpendable + tezosSpendable;

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

      <div className="burn-step-head">
        <span className="burn-step-num">1</span>
        <span className="burn-step-title">Check NFTs</span>
      </div>
      <div className="burn-checkers">
        <BurnWalletChecker onSpendableChange={setEvmSpendable} />
        <SolanaWalletChecker onSpendableChange={setSolanaSpendable} />
        <TezosWalletChecker onSpendableChange={setTezosSpendable} />
      </div>

      <div className="burn-step-head">
        <span className="burn-step-num">2</span>
        <span className="burn-step-title">Burn NFTs</span>
      </div>
      <div className="burn-chain-row">
        {["EVM", "Solana", "Tezos"].map((chain) => (
          <button
            key={chain}
            className="burn-chain-btn"
            disabled
            title="Coming soon — burning is not live yet"
          >
            Burn {chain} NFTs
          </button>
        ))}
      </div>
      <div className="burn-step-note">
        Once live: each button burns everything found for that chain (NFTs
        and $Dyl coin together where possible) in one guided signing flow,
        then shows &quot;Burned ✓ Tx: 0x1234…&quot; in place of the button.
      </div>

      <div className="burn-step-head">
        <span className="burn-step-num">3</span>
        <span className="burn-step-title">Choose how to spend it</span>
      </div>
      <div className="burn-checker burn-total-card">
        <div className="burn-total-row">
          <span className="burn-total-num">{totalSpendable.toLocaleString()}</span>
          <span className="burn-total-label">Total Free Mints</span>
        </div>
        <MintAllocator spendable={totalSpendable} />
      </div>

      <div className="burn-step-head">
        <span className="burn-step-num">4</span>
        <span className="burn-step-title">Mint</span>
      </div>
      <button
        className="burn-chain-btn"
        disabled
        title="Coming soon — minting is not live yet"
        style={{ marginBottom: 28 }}
      >
        Mint
      </button>

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
