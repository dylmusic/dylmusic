"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { createPublicClient, http, getAddress, formatUnits, Chain } from "viem";
import { mainnet, base, polygon } from "viem/chains";
import { LEGACY_ASSETS, LegacyAsset, LegacyChain } from "@/lib/legacyCollections";
import { CARD_TIER_MINTS, VIP_MINTS_ESTIMATE, dylMintsForBalance } from "@/lib/burnCredits";
import { fetchTieredCollectionBreakdown, TierBreakdown } from "@/lib/tieredCollectionCheck";

const ERC721_BALANCE_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const ERC1155_BALANCE_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const ERC20_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

// Real Ethereum-mainnet NFT reads only for now (no known Base/Polygon NFT
// contract addresses yet — see CLAUDE.md, the old Polygon collection is on
// a now-defunct platform with no address recorded) — the fungible $DYL
// entries use a different balance shape (raw amount, not "how many NFTs")
// and are checked separately, across every EVM chain $DYL actually exists
// on ("EVM Wallet Checker" — same address, same wallet, 3 chains).
//
// The tiered collection (0x253bfce..., "Old Dyl NFT collection") is
// excluded from this generic balanceOf list — it gets its own exact
// per-token tier lookup via fetchTieredCollectionBreakdown() instead of a
// plain count, since a plain balanceOf can't tell Standard from VIP.
const TIERED_COLLECTION_NAME = "Old Dyl NFT collection";
const ETH_NFT_ASSETS = LEGACY_ASSETS.filter(
  (a) => a.chain === "ethereum" && a.kind === "nft" && a.name !== TIERED_COLLECTION_NAME
);
const EVM_DYL_TOKENS = LEGACY_ASSETS.filter(
  (a) => a.kind === "token" && (a.chain === "ethereum" || a.chain === "base" || a.chain === "polygon")
);

const EVM_CHAIN_CONFIG: Partial<Record<LegacyChain, { viemChain: Chain; rpcUrl?: string }>> = {
  ethereum: { viemChain: mainnet, rpcUrl: "https://ethereum-rpc.publicnode.com" },
  base: { viemChain: base },
  polygon: { viemChain: polygon },
};

interface AssetResult {
  asset: LegacyAsset;
  count: number;
  error?: string;
}

interface DylResult {
  asset: LegacyAsset;
  balance: number;
  error?: string;
}

export default function BurnWalletChecker({
  onSpendableChange,
}: {
  onSpendableChange?: (n: number) => void;
}) {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<AssetResult[] | null>(null);
  const [dylResults, setDylResults] = useState<DylResult[] | null>(null);
  const [tierBreakdown, setTierBreakdown] = useState<TierBreakdown | null>(null);

  async function checkWallet() {
    if (!address) return;
    setChecking(true);
    setResults(null);
    setDylResults(null);
    setTierBreakdown(null);
    const checked = getAddress(address);

    const ethClient = createPublicClient({
      chain: EVM_CHAIN_CONFIG.ethereum!.viemChain,
      transport: http(EVM_CHAIN_CONFIG.ethereum!.rpcUrl),
    });

    const [nftResults, dyl, tiers] = await Promise.all([
      Promise.all(
        ETH_NFT_ASSETS.map(async (asset): Promise<AssetResult> => {
          try {
            const contractAddress = getAddress(asset.address);
            const raw = asset.tokenId
              ? await ethClient.readContract({
                  address: contractAddress,
                  abi: ERC1155_BALANCE_ABI,
                  functionName: "balanceOf",
                  args: [checked, BigInt(asset.tokenId)],
                })
              : await ethClient.readContract({
                  address: contractAddress,
                  abi: ERC721_BALANCE_ABI,
                  functionName: "balanceOf",
                  args: [checked],
                });
            return { asset, count: Number(raw) };
          } catch (e) {
            return { asset, count: 0, error: e instanceof Error ? e.message : "Check failed" };
          }
        })
      ),
      // Same wallet address, checked across every EVM chain $DYL exists on —
      // "EVM Wallet Checker", not just Ethereum.
      Promise.all(
        EVM_DYL_TOKENS.map(async (asset): Promise<DylResult> => {
          const cfg = EVM_CHAIN_CONFIG[asset.chain];
          if (!cfg) return { asset, balance: 0, error: "Unsupported chain" };
          try {
            const client = createPublicClient({ chain: cfg.viemChain, transport: http(cfg.rpcUrl) });
            const tokenAddress = getAddress(asset.address);
            const [rawBalance, decimals] = await Promise.all([
              client.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: "balanceOf", args: [checked] }),
              client.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: "decimals" }),
            ]);
            return { asset, balance: Number(formatUnits(rawBalance, decimals)) };
          } catch (e) {
            return { asset, balance: 0, error: e instanceof Error ? e.message : "Check failed" };
          }
        })
      ),
      // Real, exact per-token tier lookup (Blockscout's public instances
      // API — see lib/tieredCollectionCheck.ts) instead of a balanceOf
      // count or an estimated range.
      fetchTieredCollectionBreakdown(checked),
    ]);

    setResults(nftResults);
    setDylResults(dyl);
    setTierBreakdown(tiers);
    setChecking(false);
  }

  const { totalCount, totalDylBalance, untieredCount, spendable } = useMemo(() => {
    if (!results) {
      return { totalCount: 0, totalDylBalance: 0, untieredCount: 0, spendable: 0 };
    }
    let untiered = 0;
    for (const r of results) untiered += r.count;
    const tiers = tierBreakdown;
    const tCredits = tiers
      ? tiers.standard * (CARD_TIER_MINTS.standard ?? 0) +
        tiers.gold * (CARD_TIER_MINTS.gold ?? 0) +
        tiers.platinum * (CARD_TIER_MINTS.platinum ?? 0) +
        tiers.vip * VIP_MINTS_ESTIMATE
      : 0;
    const dylBalance = dylResults?.reduce((sum, r) => sum + r.balance, 0) ?? 0;
    const dylMints = dylMintsForBalance(dylBalance);
    return {
      totalCount: untiered + (tiers?.total ?? 0),
      totalDylBalance: dylBalance,
      untieredCount: untiered,
      spendable: tCredits + dylMints,
    };
  }, [results, dylResults, tierBreakdown]);

  useEffect(() => {
    onSpendableChange?.(spendable);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spendable]);

  return (
    <div className="burn-checker">
      <div className="burn-checker-head">
        <div>
          <div className="burn-checker-title">
            EVM Wallet Checker
            {results && <span className="checker-checked-badge">✓ Checked</span>}
          </div>
          <div className="burn-checker-sub">Check all EVM wallets at once</div>
        </div>
        <div className="checker-head-actions">
          {!isConnected ? (
            <button className="btn-burn-hero burn-checker-btn" onClick={() => openConnectModal?.()}>
              Connect Wallet
            </button>
          ) : (
            <button
              className="btn-burn-hero burn-checker-btn"
              onClick={checkWallet}
              disabled={checking}
              title={results ? "Click to re-check" : undefined}
            >
              {checking ? (
                <>
                  <span className="btn-spinner" />
                  Checking Wallet…
                </>
              ) : results ? (
                `${spendable.toLocaleString()} Free Mint${spendable === 1 ? "" : "s"} ↻`
              ) : (
                "Check My Wallet"
              )}
            </button>
          )}
          {results && (
            <button
              className="checker-toggle"
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? "Collapse results" : "Expand results"}
            >
              {open ? "▲" : "▼"}
            </button>
          )}
        </div>
      </div>

      {results && open && (
        <>
          <div className="burn-checker-total burn-checker-total-combined">
            <div className="burn-checker-total-part">
              <span className="burn-checker-total-num">{totalCount}</span>
              <span className="burn-checker-total-label">eligible NFT{totalCount === 1 ? "" : "s"} found</span>
            </div>
            <div className="burn-checker-total-part">
              <span className="burn-checker-total-num">
                {totalDylBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
              <span className="burn-checker-total-label">$DYL coin found</span>
            </div>
            <div className="burn-checker-total-part burn-checker-total-equals">
              <span className="burn-checker-total-num">
                = {spendable.toLocaleString()}
              </span>
              <span className="burn-checker-total-label">free mint{spendable === 1 ? "" : "s"}</span>
            </div>
          </div>

          <div className="burn-checker-breakdown">
            {tierBreakdown && (
              <div className="burn-checker-row">
                <span className="burn-checker-row-name">{TIERED_COLLECTION_NAME}</span>
                <span className={`burn-checker-row-count${tierBreakdown.total > 0 ? " has" : ""}`}>
                  {tierBreakdown.error ? "—" : tierBreakdown.total}
                </span>
              </div>
            )}
            {results.map((r) => (
              <div key={r.asset.name + (r.asset.tokenId ?? "")} className="burn-checker-row">
                <span className="burn-checker-row-name">{r.asset.name}</span>
                <span className={`burn-checker-row-count${r.count > 0 ? " has" : ""}`}>
                  {r.error ? "—" : r.count}
                </span>
              </div>
            ))}
            {dylResults?.map((r) => (
              <div key={`dyl-${r.asset.chain}`} className="burn-checker-row">
                <span className="burn-checker-row-name">$DYL ({r.asset.chainLabel})</span>
                <span className={`burn-checker-row-count${r.balance > 0 ? " has" : ""}`}>
                  {r.error ? "—" : r.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              </div>
            ))}
          </div>

          <div className="credits-panel">
            <div className="credits-head">
              <span className="credits-head-title">What your old bag is worth</span>
              <span className="credits-head-note">
                Free-mint credits, per CLAUDE.md&apos;s burn table — real per-token tiers, read live off-chain.
              </span>
            </div>

            <div className="credits-rows">
              {tierBreakdown && tierBreakdown.standard > 0 && (
                <div className="credits-row">
                  <span className="credits-row-label">{tierBreakdown.standard} Standard card{tierBreakdown.standard === 1 ? "" : "s"}</span>
                  <span className="credits-row-value">{tierBreakdown.standard * (CARD_TIER_MINTS.standard ?? 0)} mints</span>
                </div>
              )}
              {tierBreakdown && tierBreakdown.gold > 0 && (
                <div className="credits-row">
                  <span className="credits-row-label">{tierBreakdown.gold} Gold card{tierBreakdown.gold === 1 ? "" : "s"}</span>
                  <span className="credits-row-value">{tierBreakdown.gold * (CARD_TIER_MINTS.gold ?? 0)} mints</span>
                </div>
              )}
              {tierBreakdown && tierBreakdown.platinum > 0 && (
                <div className="credits-row">
                  <span className="credits-row-label">{tierBreakdown.platinum} Platinum card{tierBreakdown.platinum === 1 ? "" : "s"}</span>
                  <span className="credits-row-value">{tierBreakdown.platinum * (CARD_TIER_MINTS.platinum ?? 0)} mints</span>
                </div>
              )}
              {tierBreakdown && tierBreakdown.diamond > 0 && (
                <div className="credits-row muted">
                  <span className="credits-row-label">{tierBreakdown.diamond} Diamond card{tierBreakdown.diamond === 1 ? "" : "s"}</span>
                  <span className="credits-row-value">Not priced yet</span>
                </div>
              )}
              {tierBreakdown && tierBreakdown.vip > 0 && (
                <div className="credits-row">
                  <span className="credits-row-label">{tierBreakdown.vip} VIP item{tierBreakdown.vip === 1 ? "" : "s"} (album cover / single / PFP)</span>
                  <span className="credits-row-value">{tierBreakdown.vip * VIP_MINTS_ESTIMATE} mints</span>
                </div>
              )}
              {tierBreakdown && tierBreakdown.mystery > 0 && (
                <div className="credits-row muted">
                  <span className="credits-row-label">{tierBreakdown.mystery} unrevealed Mystery Card{tierBreakdown.mystery === 1 ? "" : "s"}</span>
                  <span className="credits-row-value">Tier unknown</span>
                </div>
              )}
              {tierBreakdown?.error && (
                <div className="credits-row muted">
                  <span className="credits-row-label">Tier lookup failed — showing what did resolve.</span>
                </div>
              )}
              {untieredCount > 0 && (
                <div className="credits-row muted">
                  <span className="credits-row-label">{untieredCount} other NFT{untieredCount === 1 ? "" : "s"} held</span>
                  <span className="credits-row-value">Not priced yet</span>
                </div>
              )}
              {totalDylBalance > 0 && (
                <div className="credits-row">
                  <span className="credits-row-label">
                    {totalDylBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })} $DYL held (all EVM
                    chains)
                  </span>
                  <span className="credits-row-value">{dylMintsForBalance(totalDylBalance)} mints</span>
                </div>
              )}
              {(tierBreakdown?.total ?? 0) === 0 && untieredCount === 0 && totalDylBalance === 0 && (
                <div className="credits-row muted">
                  <span className="credits-row-label">Nothing eligible found in this wallet.</span>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
