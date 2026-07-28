"use client";

import { useEffect, useState } from "react";
import { useAccount, usePublicClient, useSendTransaction, useSwitchChain } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { ADMIN_WALLET, isAdminWallet, CONTRACT_TARGETS, type ContractTarget } from "@/lib/admin";
import {
  buildDeployImplementationTx,
  buildDeployProxyTx,
  buildUpgradeTx,
  buildAdminMintTx,
  buildDeployAlbumBuyerTx,
} from "@/lib/contractDeploy";
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
  | { step: "implementation" | "proxy" | "albumBuyer" | "newImplementation" | "upgrade" | "mint"; label: string }
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

  async function handleMintFirstTen(target: ContractTarget) {
    if (!target.address || !address) return;
    try {
      await ensureChain(target);
      setPhase((p) => ({ ...p, [target.key]: { step: "mint", label: "Minting editions #1-10…" } }));
      // trackId 1 — lib/albums.ts's real tracks start at index 1. Repeat per
      // track as new albums ship; this button covers one track at a time.
      await sendAndWait(buildAdminMintTx(target.address as Address, BigInt(1), BigInt(10), address as Address));
      setPhase((p) => ({
        ...p,
        [target.key]: { step: "done", label: "Editions #1-10 minted to admin wallet. Auto-listing is a separate, not-yet-built step (see CLAUDE.md)." },
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
                          title="Mints editions #1-10 (trackId 1) to the admin wallet. Auto-listing at $10-$100 per CLAUDE.md's Deployment minting strategy is a separate, not-yet-built step."
                          onClick={() => handleMintFirstTen(c)}
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
