"use client";

import { useEffect, useState } from "react";
import { useAccount, usePublicClient, useSendTransaction, useSwitchChain } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { ADMIN_WALLET, isAdminWallet, CONTRACT_TARGETS, type ContractTarget } from "@/lib/admin";
import {
  buildDeployImplementationTx,
  buildDeployProxyTx,
  buildUpgradeTx,
  buildAdminMintTx,
  buildDeployAlbumBuyerTx,
} from "@/lib/contractDeploy";
import { wagmiConfig } from "@/lib/web3";
import { ALBUMS, type ChainKey } from "@/lib/albums";
import { getNativeTokenForChain } from "@/lib/dylTokens";
import { getTokenUsdPrice } from "@/lib/tokenUsdPrice";
import { priceUsdForEdition } from "@/lib/editionPricing";
import { encodeTokenId } from "@/lib/tokenIdScheme";
import { viemWalletClientToEthersSigner } from "@/lib/ethersSigner";
import { createSiteListings } from "@/lib/siteListing";
import { createOpenSeaListings, getOpenSeaSdk, isOpenSeaListable } from "@/lib/openSeaListing";
import type { Address } from "viem";

interface ChatMessage {
  id: string;
  wallet: string;
  chain: string;
  text: string;
  ts: number;
}

// Admin-settable, no oracle (mirrors the contract's own admin-only
// setMintPrice) — a rough ETH-denominated stand-in for the site's $0.99
// public mint price. Fine-tune per chain after deploy via setMintPrice as
// ETH/USD drifts; this is only ever the INITIAL value passed to initialize().
const DEFAULT_MINT_PRICE_WEI = BigInt("300000000000000"); // 0.0003 ETH

function metadataBaseURI(chainSlug: string) {
  return `https://dylmusic.vercel.app/api/metadata/${chainSlug}/`;
}

function truncate(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

type DeployPhase =
  | {
      step: "implementation" | "proxy" | "albumBuyer" | "newImplementation" | "upgrade" | "mint" | "list-site" | "list-opensea";
      label: string;
    }
  | { step: "done"; label: string }
  | { step: "error"; label: string };

export default function AdminPage() {
  const { address, isConnected, chainId: connectedChainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { sendTransactionAsync } = useSendTransaction();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient();
  const allowed = isAdminWallet(address);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatConfigured, setChatConfigured] = useState<boolean | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [targets, setTargets] = useState<ContractTarget[]>(CONTRACT_TARGETS);
  const [phase, setPhase] = useState<Record<string, DeployPhase | undefined>>({});

  async function loadChat() {
    try {
      const res = await fetch("/api/chat", { cache: "no-store" });
      const data = await res.json();
      setChatConfigured(!!data.configured);
      setMessages(data.messages ?? []);
    } catch {
      setChatConfigured(false);
    }
  }

  useEffect(() => {
    if (allowed) loadChat();
  }, [allowed]);

  async function handleDelete(id: string) {
    if (!address) return;
    setDeletingId(id);
    try {
      await fetch("/api/chat", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, wallet: address }),
      });
      await loadChat();
    } finally {
      setDeletingId(null);
    }
  }

  function setTargetField(key: ContractTarget["key"], patch: Partial<ContractTarget>) {
    setTargets((prev) => prev.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  }

  async function ensureChain(target: ContractTarget) {
    if (!target.chainId) throw new Error(`No chainId configured for ${target.key}`);
    if (connectedChainId !== target.chainId) {
      await switchChainAsync({ chainId: target.chainId });
    }
  }

  async function sendAndWait(tx: { to?: Address; data: `0x${string}`; value: bigint }) {
    const hash = await sendTransactionAsync(tx);
    const receipt = await publicClient!.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`Transaction reverted: ${hash}`);
    return receipt;
  }

  async function handleDeploy(target: ContractTarget) {
    if (!address) return;
    try {
      await ensureChain(target);

      setPhase((p) => ({ ...p, [target.key]: { step: "implementation", label: "1/3 — Deploying implementation…" } }));
      const implReceipt = await sendAndWait(buildDeployImplementationTx());
      const implementationAddress = implReceipt.contractAddress as Address;
      if (!implementationAddress) throw new Error("No contractAddress in implementation deploy receipt");

      setPhase((p) => ({ ...p, [target.key]: { step: "proxy", label: "2/3 — Deploying proxy…" } }));
      const proxyReceipt = await sendAndWait(
        buildDeployProxyTx({
          implementationAddress,
          name: "Dyl",
          symbol: "DYL",
          admin: address as Address,
          initialMintPriceWei: DEFAULT_MINT_PRICE_WEI,
          initialMetadataBaseURI: metadataBaseURI(target.key),
        })
      );
      const proxyAddress = proxyReceipt.contractAddress as Address;
      if (!proxyAddress) throw new Error("No contractAddress in proxy deploy receipt");

      setPhase((p) => ({ ...p, [target.key]: { step: "albumBuyer", label: "3/3 — Deploying AlbumBuyer…" } }));
      const albumBuyerReceipt = await sendAndWait(buildDeployAlbumBuyerTx());
      const albumBuyerAddress = albumBuyerReceipt.contractAddress as Address;

      setTargetField(target.key, {
        address: proxyAddress,
        implementationAddress,
        albumBuyerAddress: albumBuyerAddress ?? null,
      });
      setPhase((p) => ({
        ...p,
        [target.key]: {
          step: "done",
          label: `Deployed. Proxy ${truncate(proxyAddress)} — commit this into lib/admin.ts CONTRACT_TARGETS.`,
        },
      }));
    } catch (err) {
      setPhase((p) => ({ ...p, [target.key]: { step: "error", label: describeError(err) } }));
    }
  }

  async function handleUpgrade(target: ContractTarget) {
    if (!target.address) return;
    try {
      await ensureChain(target);
      setPhase((p) => ({ ...p, [target.key]: { step: "newImplementation", label: "1/2 — Deploying new implementation…" } }));
      const implReceipt = await sendAndWait(buildDeployImplementationTx());
      const newImplementationAddress = implReceipt.contractAddress as Address;
      if (!newImplementationAddress) throw new Error("No contractAddress in implementation deploy receipt");

      setPhase((p) => ({ ...p, [target.key]: { step: "upgrade", label: "2/2 — Calling upgradeToAndCall…" } }));
      await sendAndWait(buildUpgradeTx(target.address as Address, newImplementationAddress));

      setTargetField(target.key, { implementationAddress: newImplementationAddress });
      setPhase((p) => ({
        ...p,
        [target.key]: { step: "done", label: `Upgraded. New implementation ${truncate(newImplementationAddress)}.` },
      }));
    } catch (err) {
      setPhase((p) => ({ ...p, [target.key]: { step: "error", label: describeError(err) } }));
    }
  }

  // Mints editions #1-10 for EVERY real track (all 19 on Crypto Rich
  // (Deluxe) today — 190 NFTs total on this chain), then lists every one of
  // those 190 editions TWICE: once as a genuinely free, non-expiring
  // Seaport order signed straight to our own site (lib/siteListing.ts), and
  // once posted through OpenSea's own Order Posting API so it is actually
  // visible on opensea.io (lib/openSeaListing.ts, their real 1% fee, capped
  // at their own 6-month maximum listing duration — "never expire" is not
  // possible on their side, confirmed against their own docs; renewing
  // those before they lapse is a manual admin action, not automated).
  // Pricing is the inverse-rarity scale from CLAUDE.md's "Deployment
  // minting strategy": edition #10 lists at $10 up to edition #1 at $100,
  // converted into the chain's native currency at the live rate.
  async function handleMintAndListAlbum(target: ContractTarget) {
    if (!target.address || !address || !target.chainId) return;
    const chainKey = target.key as ChainKey; // only called for the 3 EVM targets (robinhood/base/ethereum) — see the `evm` check at the call site
    const tracks = ALBUMS.flatMap((a) => a.tracks);
    if (tracks.length === 0) return;
    try {
      await ensureChain(target);

      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        setPhase((p) => ({
          ...p,
          [target.key]: { step: "mint", label: `Minting "${track.title}" #1-10 (track ${i + 1}/${tracks.length})…` },
        }));
        await sendAndWait(buildAdminMintTx(target.address as Address, BigInt(track.index), BigInt(10), address as Address));
      }

      const nativeToken = getNativeTokenForChain(chainKey);
      const nativeUsd = await getTokenUsdPrice(nativeToken);
      if (!nativeUsd) {
        throw new Error(`Minted all editions, but could not price ${nativeToken.symbol} right now — try listing again shortly.`);
      }

      const editions = tracks.flatMap((track) =>
        Array.from({ length: 10 }, (_, e) => {
          const editionNumber = e + 1;
          const priceUsd = priceUsdForEdition(editionNumber);
          const priceWei = BigInt(Math.round((priceUsd / nativeUsd) * 1e18));
          return { tokenId: encodeTokenId(track.index, editionNumber), priceWei };
        })
      );

      // A fresh viem client for THIS chain, not the reactive useWalletClient()
      // hook value — that snapshot can still reflect the chain the wallet
      // was on before ensureChain's own switch above (same staleness bug
      // already fixed for /swap's ensureEvmChain, same fix here).
      const freshClient = await getWalletClient(wagmiConfig, { chainId: target.chainId });
      const signer = await viemWalletClientToEthersSigner(freshClient);

      setPhase((p) => ({
        ...p,
        [target.key]: { step: "list-site", label: `Signing ${editions.length} listings for our own site (0% fee, never expires)…` },
      }));
      const siteOrders = await createSiteListings(
        signer,
        editions.map((e) => ({
          collectionAddress: target.address as string,
          tokenId: e.tokenId,
          priceWei: e.priceWei,
          sellerAddress: address,
        }))
      );
      await fetch("/api/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: address,
          listings: siteOrders.map((o, idx) => ({
            chainId: target.chainId,
            collectionAddress: target.address,
            tokenId: editions[idx].tokenId,
            priceWei: editions[idx].priceWei.toString(),
            sellerAddress: address,
            parameters: o.parameters,
            signature: o.signature,
            createdAt: Date.now(),
          })),
        }),
      });

      let openSeaFailures = 0;
      if (isOpenSeaListable(chainKey)) {
        setPhase((p) => ({
          ...p,
          [target.key]: { step: "list-opensea", label: `Posting ${editions.length} listings to OpenSea (1% fee, 6-month expiry)…` },
        }));
        const sdk = getOpenSeaSdk(signer, chainKey);
        const result = await createOpenSeaListings(
          sdk,
          editions.map((e) => ({
            collectionAddress: target.address as string,
            tokenId: e.tokenId,
            priceWei: e.priceWei,
            sellerAddress: address,
          }))
        );
        openSeaFailures = result.failed.length;
        if (openSeaFailures > 0) {
          console.error(`OpenSea listing failures for ${target.chainName}:`, result.failed);
        }
      }

      setPhase((p) => ({
        ...p,
        [target.key]: {
          step: "done",
          label:
            openSeaFailures > 0
              ? `Minted + listed ${editions.length} editions across ${tracks.length} tracks. ${openSeaFailures} OpenSea listing(s) failed — see console.`
              : `Minted + listed ${editions.length} editions across ${tracks.length} tracks, on our site and OpenSea.`,
        },
      }));
    } catch (err) {
      setPhase((p) => ({ ...p, [target.key]: { step: "error", label: describeError(err) } }));
    }
  }

  function describeError(err: unknown): string {
    if (err instanceof Error) return err.message;
    return "Unknown error — see console.";
  }

  const busy = (key: string) => {
    const s = phase[key]?.step;
    return s !== undefined && s !== "done" && s !== "error";
  };

  return (
    <div className="admin-wrap">
      <div className="admin-head">
        <span className="admin-logo">Dyl</span>
        <span className="admin-badge">ADMIN</span>
      </div>

      {!isConnected ? (
        <div className="admin-gate">
          <p>Connect the admin wallet to continue.</p>
          <button className="btn-connect" onClick={openConnectModal}>
            Connect Wallet
          </button>
        </div>
      ) : !allowed ? (
        <div className="admin-gate">
          <p>Access denied.</p>
          <p className="admin-gate-sub">
            Connected as {truncate(address!)} — this isn&apos;t the admin wallet.
          </p>
        </div>
      ) : (
        <div className="admin-body">
          <div className="admin-section">
            <div className="admin-section-head">
              <h2>Platform Status</h2>
            </div>
            <div className="admin-status-row">
              <span>Admin wallet</span>
              <span className="admin-status-val">{truncate(ADMIN_WALLET)}</span>
            </div>
            <div className="admin-status-row">
              <span>Chat backend (Upstash)</span>
              <span className={`admin-status-val${chatConfigured ? " ok" : " warn"}`}>
                {chatConfigured === null ? "…" : chatConfigured ? "Configured" : "Not configured"}
              </span>
            </div>
          </div>

          <div className="admin-section">
            <div className="admin-section-head">
              <h2>Chat Moderation</h2>
              <button className="admin-refresh" onClick={loadChat}>
                Refresh
              </button>
            </div>
            {messages.length === 0 ? (
              <div className="admin-empty">No messages.</div>
            ) : (
              <div className="admin-chat-list">
                {messages.map((m) => (
                  <div key={m.id} className="admin-chat-row">
                    <div className="admin-chat-row-text">
                      <strong>{truncate(m.wallet)}</strong> ({m.chain}): {m.text}
                    </div>
                    <button
                      className="admin-delete-btn"
                      disabled={deletingId === m.id}
                      onClick={() => handleDelete(m.id)}
                    >
                      {deletingId === m.id ? "…" : "Delete"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="admin-section">
            <div className="admin-section-head">
              <h2>Contracts — deploy in this order</h2>
            </div>
            <div className="admin-empty" style={{ marginBottom: 14 }}>
              One upgradable collection contract per chain — every track/album mints onto the
              existing contract as a new tokenId, never a new contract. ERC721A, not ERC-1155
              (decided 2026-07-28). See CLAUDE.md &quot;Contract Requirement&quot; before writing any
              of these. Steps 1–4 are required; step 5 (marketplace) is optional — only do it if
              OpenSea&apos;s own listing flow (Seaport) turns out not to be enough. Deploy also
              deploys that chain&apos;s AlbumBuyer wrapper in the same 3-transaction flow. Solana
              (step 4) is a separate scripted setup, not wired here — see onchain-solana/.
            </div>
            <div className="admin-contract-list">
              {targets.map((c) => {
                const p = phase[c.key];
                const evm = c.key === "robinhood" || c.key === "base" || c.key === "ethereum";
                return (
                  <div key={c.key} className={`admin-contract-row${c.optional ? " optional" : ""}`}>
                    <div className="admin-contract-step">{c.order}</div>
                    <div className="admin-contract-info">
                      <div className="admin-contract-chain">
                        {c.chainName}
                        {c.optional && <span className="admin-contract-optional-tag">Optional</span>}
                      </div>
                      <div className="admin-contract-standard">{c.standard}</div>
                      <div className="admin-contract-reason">{c.reason}</div>
                      <div className="admin-contract-addr">{c.address ?? "Not deployed"}</div>
                      {c.albumBuyerAddress && (
                        <div className="admin-contract-addr">AlbumBuyer: {c.albumBuyerAddress}</div>
                      )}
                      {p && (
                        <div className={`admin-contract-addr${p.step === "error" ? " warn" : ""}`}>{p.label}</div>
                      )}
                    </div>
                    {evm ? (
                      <div className="admin-contract-actions">
                        <button
                          className="admin-contract-btn"
                          disabled={busy(c.key) || !!c.address}
                          onClick={() => handleDeploy(c)}
                        >
                          Deploy
                        </button>
                        <button
                          className="admin-contract-btn"
                          disabled={busy(c.key) || !c.address}
                          onClick={() => handleUpgrade(c)}
                        >
                          Upgrade
                        </button>
                        <button
                          className="admin-contract-btn"
                          disabled={busy(c.key) || !c.address}
                          title="Mints editions #1-10 for every real track to the admin wallet, then lists each one on our own site (0% fee, never expires) and on OpenSea (their 1% fee, 6-month expiry — renew manually before it lapses). Price scale: edition #10 = $10 up to edition #1 = $100."
                          onClick={() => handleMintAndListAlbum(c)}
                        >
                          Mint #1-10 &amp; List
                        </button>
                      </div>
                    ) : (
                      <div className="admin-contract-actions">
                        <button className="admin-contract-btn" disabled>
                          Deploy
                        </button>
                        <button className="admin-contract-btn" disabled>
                          Upgrade
                        </button>
                        {c.key !== "marketplace" && (
                          <button className="admin-contract-btn" disabled>
                            Mint #1-10 &amp; List
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
