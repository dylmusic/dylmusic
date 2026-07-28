"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { createPublicClient, http, getAddress, formatUnits } from "viem";
import { mainnet } from "viem/chains";
import { LEGACY_ASSETS, LegacyAsset } from "@/lib/legacyCollections";
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

// Real Ethereum-mainnet NFT reads only for now — the fungible $DYL entries
// use a different balance shape (raw amount, not "how many NFTs") and are
// checked separately below.
const ETH_NFT_ASSETS = LEGACY_ASSETS.filter((a) => a.chain === "ethereum" && a.kind === "nft");
const ETH_DYL_TOKEN = LEGACY_ASSETS.find((a) => a.chain === "ethereum" && a.kind === "token") ?? null;

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
  balance: number;
  mints: number;
  error?: string;
}

const RPC_URL = "https://ethereum-rpc.publicnode.com";

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
  const [dylResult, setDylResult] = useState<DylResult | null>(null);
  const [allocation, setAllocation] = useState<Record<AllocationChain, number> | null>(null);

  async function checkWallet() {
    if (!address) return;
    setChecking(true);
    setResults(null);
    setDylResult(null);
    setAllocation(null);
    const client = createPublicClient({ chain: mainnet, transport: http(RPC_URL) });
    const checked = getAddress(address);

    const nftResults = await Promise.all(
      ETH_NFT_ASSETS.map(async (asset): Promise<AssetResult> => {
        try {
          const contractAddress = getAddress(asset.address);
          const raw = asset.tokenId
            ? await client.readContract({
                address: contractAddress,
                abi: ERC1155_BALANCE_ABI,
                functionName: "balanceOf",
                args: [checked, BigInt(asset.tokenId)],
              })
            : await client.readContract({
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

    let dyl: DylResult = { balance: 0, mints: 0 };
    if (ETH_DYL_TOKEN) {
      try {
        const tokenAddress = getAddress(ETH_DYL_TOKEN.address);
        const [rawBalance, decimals] = await Promise.all([
          client.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: "balanceOf", args: [checked] }),
          client.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: "decimals" }),
        ]);
        const balance = Number(formatUnits(rawBalance, decimals));
        dyl = { balance, mints: dylMintsForBalance(balance) };
      } catch (e) {
        dyl = { balance: 0, mints: 0, error: e instanceof Error ? e.message : "Check failed" };
      }
    }

    setResults(nftResults);
    setDylResult(dyl);
    setChecking(false);
  }

  const { totalCount, totalCreditsMin, totalCreditsMax, tieredCount, tieredMin, tieredMax, untieredCount } =
    useMemo(() => {
      if (!results) {
        return { totalCount: 0, totalCreditsMin: 0, totalCreditsMax: 0, tieredCount: 0, tieredMin: 0, tieredMax: 0, untieredCount: 0 };
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
      const dylMints = dylResult?.mints ?? 0;
      return {
        totalCount: count,
        totalCreditsMin: min + dylMints,
        totalCreditsMax: max + dylMints,
        tieredCount: tCount,
        tieredMin: min,
        tieredMax: max,
        untieredCount: untiered,
      };
    }, [results, dylResult]);

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
          <div className="burn-checker-title">Ethereum Wallet Checker</div>
          <div className="burn-checker-sub">Check your Dyl NFTs + $Dyl Coin on ETH</div>
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
          <div className="burn-checker-total">
            <span className="burn-checker-total-num">{totalCount}</span>
            <span className="burn-checker-total-label">eligible NFT{totalCount === 1 ? "" : "s"} found</span>
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
            {dylResult && (
              <div className="burn-checker-row">
                <span className="burn-checker-row-name">$DYL (Ethereum)</span>
                <span className={`burn-checker-row-count${dylResult.balance > 0 ? " has" : ""}`}>
                  {dylResult.error ? "—" : dylResult.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              </div>
            )}
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
              {dylResult && dylResult.balance > 0 && (
                <div className="credits-row">
                  <span className="credits-row-label">
                    {dylResult.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })} $DYL held
                  </span>
                  <span className="credits-row-value">{dylResult.mints} mints</span>
                </div>
              )}
              {tieredCount === 0 && untieredCount === 0 && (!dylResult || dylResult.balance === 0) && (
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
