"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { createPublicClient, http, getAddress } from "viem";
import { mainnet } from "viem/chains";
import { LEGACY_ASSETS, LegacyAsset } from "@/lib/legacyCollections";

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

// Real Ethereum-mainnet NFT reads only for now — the fungible $DYL entries
// use a different balance shape (raw amount, not "how many NFTs") and
// aren't part of "count eligible NFTs" as asked.
const ETH_NFT_ASSETS = LEGACY_ASSETS.filter((a) => a.chain === "ethereum" && a.kind === "nft");

const RPC_URL = "https://ethereum-rpc.publicnode.com";

interface AssetResult {
  asset: LegacyAsset;
  count: number;
  error?: string;
}

export default function BurnWalletChecker() {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState<AssetResult[] | null>(null);

  async function checkWallet() {
    if (!address) return;
    setChecking(true);
    setResults(null);
    const client = createPublicClient({ chain: mainnet, transport: http(RPC_URL) });
    const checked = getAddress(address);

    const out = await Promise.all(
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
    setResults(out);
    setChecking(false);
  }

  const total = results?.reduce((sum, r) => sum + r.count, 0) ?? null;

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

      {total !== null && (
        <div className="burn-checker-total">
          <span className="burn-checker-total-num">{total}</span>
          <span className="burn-checker-total-label">eligible NFT{total === 1 ? "" : "s"} found</span>
        </div>
      )}

      {results && (
        <div className="burn-checker-breakdown">
          {results.map((r) => (
            <div key={r.asset.name + (r.asset.tokenId ?? "")} className="burn-checker-row">
              <span className="burn-checker-row-name">{r.asset.name}</span>
              <span className={`burn-checker-row-count${r.count > 0 ? " has" : ""}`}>
                {r.error ? "—" : r.count}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
