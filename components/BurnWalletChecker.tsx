"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { createPublicClient, http, getAddress, formatUnits, Chain } from "viem";
import { mainnet, base, polygon } from "viem/chains";
import { LEGACY_ASSETS, LegacyAsset, LegacyChain } from "@/lib/legacyCollections";
import {
  CARD_TIER_MINTS,
  VIP_MINTS_ESTIMATE,
  dylMintsForBalance,
  ALLOCATION_CHAINS,
  AllocationChain,
} from "@/lib/burnCredits";

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
const ETH_NFT_ASSETS = LEGACY_ASSETS.filter((a) => a.chain === "ethereum" && a.kind === "nft");
const EVM_DYL_TOKENS = LEGACY_ASSETS.filter(
  (a) => a.kind === "token" && (a.chain === "ethereum" || a.chain === "base" || a.chain === "polygon")
);

const EVM_CHAIN_CONFIG: Partial<Record<LegacyChain, { viemChain: Chain; rpcUrl?: string }>> = {
  ethereum: { viemChain: mainnet, rpcUrl: "https://ethereum-rpc.publicnode.com" },
  base: { viemChain: base },
  polygon: { viemChain: polygon },
};

// The one contract with an actual tier system (0x253bfce...) — see
// CLAUDE.md "Old Dyl NFT collection (Ethereum mainnet)". We can't cheaply
// enumerate WHICH specific tokenIds a wallet holds from a public RPC (a
// full-history eth_getLogs call for this contract was tried live and
// rejected — public nodes cap the block range), so credits for this one
// collection are shown as a MIN-MAX range instead of a fabricated single
// number: min = every held item priced as the cheapest tier (Standard),
// max = every item priced as VIP. The conservative MIN is what actually
// counts toward the spendable total, so nobody can over-allocate credits
// they might not really have.
const TIERED_COLLECTION_NAME = "Old Dyl NFT collection";

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

const CHAIN_LABEL: Record<AllocationChain, string> = {
  robinhood: "Robinhood",
  base: "Base",
  solana: "Solana",
};

export default function BurnWalletChecker() {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState<AssetResult[] | null>(null);
  const [dylResults, setDylResults] = useState<DylResult[] | null>(null);
  const [allocation, setAllocation] = useState<Record<AllocationChain, number> | null>(null);

  async function checkWallet() {
    if (!address) return;
    setChecking(true);
    setResults(null);
    setDylResults(null);
    setAllocation(null);
    const checked = getAddress(address);

    const ethClient = createPublicClient({
      chain: EVM_CHAIN_CONFIG.ethereum!.viemChain,
      transport: http(EVM_CHAIN_CONFIG.ethereum!.rpcUrl),
    });

    const nftResults = await Promise.all(
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
    );

    // Same wallet address, checked across every EVM chain $DYL exists on —
    // "EVM Wallet Checker", not just Ethereum.
    const dyl = await Promise.all(
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
    );

    setResults(nftResults);
    setDylResults(dyl);
    setChecking(false);
  }

  const {
    totalCount,
    totalDylBalance,
    totalCreditsMin,
    totalCreditsMax,
    tieredCount,
    tieredMin,
    tieredMax,
    untieredCount,
  } = useMemo(() => {
    if (!results) {
      return {
        totalCount: 0,
        totalDylBalance: 0,
        totalCreditsMin: 0,
        totalCreditsMax: 0,
        tieredCount: 0,
        tieredMin: 0,
        tieredMax: 0,
        untieredCount: 0,
      };
    }
    let count = 0;
    let tCount = 0;
    let untiered = 0;
    for (const r of results) {
      count += r.count;
      if (r.asset.name === TIERED_COLLECTION_NAME) tCount += r.count;
      else untiered += r.count;
    }
    const min = tCount * (CARD_TIER_MINTS.standard ?? 0);
    const max = tCount * VIP_MINTS_ESTIMATE;
    const dylBalance = dylResults?.reduce((sum, r) => sum + r.balance, 0) ?? 0;
    const dylMints = dylMintsForBalance(dylBalance);
    return {
      totalCount: count,
      totalDylBalance: dylBalance,
      totalCreditsMin: min + dylMints,
      totalCreditsMax: max + dylMints,
      tieredCount: tCount,
      tieredMin: min,
      tieredMax: max,
      untieredCount: untiered,
    };
  }, [results, dylResults]);

  const spendable = totalCreditsMin;

  function initAllocation() {
    if (allocation) return;
    const base = Math.floor(spendable / ALLOCATION_CHAINS.length);
    let remainder = spendable - base * ALLOCATION_CHAINS.length;
    const next = {} as Record<AllocationChain, number>;
    for (const c of ALLOCATION_CHAINS) {
      next[c] = base + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
    }
    setAllocation(next);
  }

  const allocatedTotal = allocation ? ALLOCATION_CHAINS.reduce((s, c) => s + allocation[c], 0) : 0;
  const remaining = spendable - allocatedTotal;

  function adjust(chain: AllocationChain, delta: number) {
    if (!allocation) return;
    const next = { ...allocation };
    const nextVal = next[chain] + delta;
    if (nextVal < 0) return;
    if (delta > 0 && remaining <= 0) return;
    next[chain] = nextVal;
    setAllocation(next);
  }

  return (
    <div className="burn-checker">
      <div className="burn-checker-head">
        <div>
          <div className="burn-checker-title">EVM Wallet Checker</div>
          <div className="burn-checker-sub">Check all EVM wallets at once</div>
        </div>
        {!isConnected ? (
          <button className="btn-burn-hero burn-checker-btn" onClick={() => openConnectModal?.()}>
            Connect Wallet
          </button>
        ) : (
          <button className="btn-burn-hero burn-checker-btn" onClick={checkWallet} disabled={checking}>
            {checking ? "Checking…" : "Check My Wallet"}
          </button>
        )}
      </div>

      {results && (
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
          </div>

          <div className="burn-checker-breakdown">
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
                Free-mint credits, per CLAUDE.md&apos;s burn table — a rough v1, not final.
              </span>
            </div>

            <div className="credits-rows">
              {tieredCount > 0 && (
                <div className="credits-row">
                  <span className="credits-row-label">
                    {tieredCount} card{tieredCount === 1 ? "" : "s"} from the tiered collection
                  </span>
                  <span className="credits-row-value">
                    {tieredMin === tieredMax ? tieredMin : `${tieredMin}–${tieredMax}`} mints
                  </span>
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
              {tieredCount === 0 && untieredCount === 0 && totalDylBalance === 0 && (
                <div className="credits-row muted">
                  <span className="credits-row-label">Nothing eligible found in this wallet.</span>
                </div>
              )}
            </div>

            {spendable > 0 && (
              <>
                <div className="credits-spendable">
                  <span className="credits-spendable-num">{spendable}</span>
                  <span className="credits-spendable-label">
                    spendable credit{spendable === 1 ? "" : "s"}
                    {tieredMax > tieredMin ? " (conservative — using the low end of the tier range)" : ""}
                  </span>
                </div>

                {!allocation ? (
                  <button className="btn-burn-hero credits-plan-btn" onClick={initAllocation}>
                    Plan how to spend it
                  </button>
                ) : (
                  <div className="credits-allocator">
                    <div className="credits-allocator-head">
                      <span>Split your {spendable} credits across chains</span>
                      <span className={`credits-remaining${remaining !== 0 ? " warn" : ""}`}>
                        {remaining === 0 ? "All allocated" : `${remaining} left to place`}
                      </span>
                    </div>
                    {ALLOCATION_CHAINS.map((c) => (
                      <div className="credits-alloc-row" key={c}>
                        <span className="credits-alloc-chain">{CHAIN_LABEL[c]}</span>
                        <div className="credits-alloc-stepper">
                          <button onClick={() => adjust(c, -1)} disabled={allocation[c] <= 0} aria-label={`Fewer on ${CHAIN_LABEL[c]}`}>
                            −
                          </button>
                          <span className="credits-alloc-num">{allocation[c]}</span>
                          <button onClick={() => adjust(c, 1)} disabled={remaining <= 0} aria-label={`More on ${CHAIN_LABEL[c]}`}>
                            +
                          </button>
                        </div>
                      </div>
                    ))}
                    <div className="credits-alloc-note">
                      Not submitted anywhere yet — this just plans it out. Real burning + minting isn&apos;t live.
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
