"use client";

import { useState } from "react";
import { useAccount, useSendTransaction, useSwitchChain, ConnectorChainMismatchError } from "wagmi";
import { getWalletClient, getPublicClient } from "wagmi/actions";
import { encodeFunctionData, type Address } from "viem";
import { LEGACY_ASSETS, LegacyAsset } from "@/lib/legacyCollections";
import BurnWalletChecker from "@/components/BurnWalletChecker";
import SolanaWalletChecker from "@/components/SolanaWalletChecker";
import TezosWalletChecker from "@/components/TezosWalletChecker";
import MintAllocator from "@/components/MintAllocator";
import MintSuccessModal, { type MintSuccessInfo } from "@/components/MintSuccessModal";
import { CONTRACT_TARGETS } from "@/lib/admin";
import { BurnClaimRedeemerAbi } from "@/lib/contractDeploy";
import { wagmiConfig } from "@/lib/web3";

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
      <span className="burn-row-btn" title="Burn this specific item from its own wallet checker above, once checked">
        See checker ↑
      </span>
    </div>
  );
}

export default function BurnPageClient() {
  const [showContracts, setShowContracts] = useState(false);
  const { address, isConnected } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const { switchChainAsync } = useSwitchChain();

  // Each checker reports its own REAL, server-verified credited total up
  // here (see BurnWalletChecker/SolanaWalletChecker's realLedgerSpendable —
  // never the pre-burn holdings estimate) so the page can show one
  // combined real number and plan a chain split against it.
  const [evmSpendable, setEvmSpendable] = useState(0);
  const [solanaSpendable, setSolanaSpendable] = useState(0);
  const [tezosSpendable, setTezosSpendable] = useState(0);
  const totalSpendable = evmSpendable + solanaSpendable + tezosSpendable;

  const [robinhoodAllocation, setRobinhoodAllocation] = useState(0);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [mintSuccess, setMintSuccess] = useState<MintSuccessInfo | null>(null);

  const robinhoodTarget = CONTRACT_TARGETS.find((t) => t.key === "robinhood");

  async function handleMint() {
    if (!address || robinhoodAllocation <= 0 || !robinhoodTarget?.address || !robinhoodTarget.burnClaimRedeemerAddress) return;
    setClaiming(true);
    setClaimError(null);
    try {
      const res = await fetch("/api/burn/claim-voucher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: address, robinhoodCount: robinhoodAllocation }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to get a claim voucher.");
      const { voucher, signature } = data as {
        voucher: {
          wallet: string;
          collection: string;
          trackIds: number[];
          quantities: number[];
          claimId: `0x${string}`;
          expiry: number;
          chainId: number;
        };
        signature: `0x${string}`;
      };

      // Fresh wallet client, switched to Robinhood Chain — same "stale
      // reactive client can't be trusted after a mid-handler chain switch"
      // discipline used everywhere else real EVM txs get sent in this app.
      await switchChainAsync({ chainId: voucher.chainId });
      let walletClient;
      for (let attempt = 0; ; attempt++) {
        try {
          walletClient = await getWalletClient(wagmiConfig, { chainId: voucher.chainId });
          break;
        } catch (e) {
          if (attempt >= 5 || !(e instanceof ConnectorChainMismatchError)) throw e;
          await new Promise((r) => setTimeout(r, 250));
        }
      }

      const calldata = encodeFunctionData({
        abi: BurnClaimRedeemerAbi,
        functionName: "claim",
        args: [
          {
            wallet: voucher.wallet as Address,
            collection: voucher.collection as Address,
            trackIds: voucher.trackIds.map((n) => BigInt(n)),
            quantities: voucher.quantities.map((n) => BigInt(n)),
            claimId: voucher.claimId,
            expiry: BigInt(voucher.expiry),
            chainId: BigInt(voucher.chainId),
          },
          signature,
        ],
      });

      const hash = await sendTransactionAsync({
        to: robinhoodTarget.burnClaimRedeemerAddress as Address,
        data: calldata,
        value: BigInt(0),
        chainId: voucher.chainId,
      });
      const publicClient = getPublicClient(wagmiConfig, { chainId: voucher.chainId });
      const receipt = await publicClient!.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Claim transaction reverted.");

      const totalEditions = voucher.quantities.reduce((s, q) => s + q, 0);
      setMintSuccess({
        trackTitle: "Burn & Mint",
        editionNumber: null,
        priceUsd: 0,
        trackCount: totalEditions,
      });
      setRobinhoodAllocation(0);
    } catch (e) {
      setClaimError(e instanceof Error ? e.message : "Claim failed.");
    } finally {
      setClaiming(false);
    }
  }

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
        Burning is real on Ethereum + Solana (Tezos coming soon). Claiming free mints is live on Robinhood Chain —
        more chains as their collections deploy.
      </div>

      <div className="burn-step-head">
        <span className="burn-step-num">1</span>
        <span className="burn-step-title">Check &amp; Burn</span>
      </div>
      <div className="burn-checkers">
        <BurnWalletChecker onSpendableChange={setEvmSpendable} />
        <SolanaWalletChecker onSpendableChange={setSolanaSpendable} />
        <TezosWalletChecker onSpendableChange={setTezosSpendable} />
      </div>

      <div className="burn-step-head">
        <span className="burn-step-num">2</span>
        <span className="burn-step-title">Choose how to spend it</span>
      </div>
      <div className="burn-checker burn-total-card">
        <div className="burn-total-row">
          <span className="burn-total-num">{totalSpendable.toLocaleString()}</span>
          <span className="burn-total-label">Total Real Free Mints</span>
        </div>
        <MintAllocator spendable={totalSpendable} onAllocationChange={setRobinhoodAllocation} />
      </div>

      <div className="burn-step-head">
        <span className="burn-step-num">3</span>
        <span className="burn-step-title">Mint</span>
      </div>
      <button
        className="burn-chain-btn"
        disabled={!isConnected || robinhoodAllocation <= 0 || claiming}
        onClick={handleMint}
        title={!isConnected ? "Connect your EVM wallet first" : robinhoodAllocation <= 0 ? "Plan a Robinhood allocation above first" : undefined}
      >
        {claiming ? "Minting…" : `Mint ${robinhoodAllocation > 0 ? robinhoodAllocation.toLocaleString() : ""} on Robinhood`}
      </button>
      {claimError && <div className="burn-step-note warn">Claim failed: {claimError}</div>}
      <div className="burn-step-note" style={{ marginBottom: 28 }}>
        Mint is completely random — you may or may not get the full album.
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

      {mintSuccess && <MintSuccessModal info={mintSuccess} onClose={() => setMintSuccess(null)} />}
    </div>
  );
}
