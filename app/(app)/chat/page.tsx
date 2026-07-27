"use client";

import { useEffect, useRef, useState } from "react";
import { ALBUMS } from "@/lib/albums";
import { ownsAnyEdition } from "@/lib/holdings";
import { getNickname } from "@/lib/nicknames";
import { useAppShell } from "@/components/AppShellContext";

interface ChatMessage {
  id: string;
  wallet: string;
  chain: string;
  text: string;
  ts: number;
}

const ALL_TRACK_IDS = ALBUMS.flatMap((a) => a.tracks.map((t) => t.id));

function truncate(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function timeAgo(ts: number) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function ChatPage() {
  const { chain, walletAddress, requestConnect } = useAppShell();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [tick, setTick] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const canPost = !!walletAddress && ownsAnyEdition(chain, walletAddress, ALL_TRACK_IDS);

  async function load() {
    try {
      const res = await fetch("/api/chat", { cache: "no-store" });
      const data = await res.json();
      setMessages(data.messages ?? []);
    } catch {
      // best-effort — same tolerance as the rest of this prototype's telemetry
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setTick((n) => n + 1);
  }, [walletAddress, chain]);
  void tick;

  async function send() {
    const text = draft.trim();
    if (!text || !walletAddress || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: walletAddress, chain, text }),
      });
      if (res.ok) {
        setDraft("");
        await load();
      }
    } catch {
      // best-effort — same tolerance as the rest of this prototype's telemetry
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="chat-wrap">
      <div className="dash-page-head">
        <div className="dash-eyebrow">Chat</div>
        <h1>Member Chat</h1>
      </div>

      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && (
          <div className="chat-empty">No messages yet — be the first to post.</div>
        )}
        {messages.map((m) => {
          const name = getNickname(m.wallet) ?? truncate(m.wallet);
          return (
            <div key={m.id} className="chat-row">
              <div className="chat-row-head">
                <span className="chat-row-who">{name}</span>
                <span className="chat-row-chain">{m.chain}</span>
                <span className="chat-row-time">{timeAgo(m.ts)}</span>
              </div>
              <div className="chat-row-text">{m.text}</div>
            </div>
          );
        })}
      </div>

      <div className="chat-composer">
        <div
          className={`chat-input-row${!canPost ? " disabled" : ""}`}
          onClick={() => {
            if (!walletAddress) requestConnect();
          }}
        >
          <input
            value={draft}
            maxLength={500}
            placeholder={canPost ? "Say something…" : "You must hold a Dyl NFT to chat"}
            disabled={!canPost}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
            }}
          />
          <button
            className="btn-buy"
            onClick={send}
            disabled={!canPost || sending || !draft.trim()}
          >
            {sending ? "…" : "Post"}
          </button>
        </div>
      </div>
    </div>
  );
}
