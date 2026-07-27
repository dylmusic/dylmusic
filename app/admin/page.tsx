"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { ADMIN_WALLET, isAdminWallet } from "@/lib/admin";

interface ChatMessage {
  id: string;
  wallet: string;
  chain: string;
  text: string;
  ts: number;
}

function truncate(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function AdminPage() {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const allowed = isAdminWallet(address);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatConfigured, setChatConfigured] = useState<boolean | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
              <h2>Contracts</h2>
            </div>
            <div className="admin-empty">
              No contracts deployed yet on any chain — everything is a local simulated ledger. Once
              there&apos;s a real contract to deploy, tell Claude which one and a real deploy flow
              (bytecode + constructor args + a Deploy button signed from this wallet) goes here.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
