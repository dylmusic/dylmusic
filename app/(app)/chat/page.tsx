"use client";

import { useEffect, useRef, useState } from "react";
import { ALBUMS } from "@/lib/albums";
import { ownsAnyEdition } from "@/lib/holdings";
import { getNickname } from "@/lib/nicknames";
import { isAdminWallet } from "@/lib/admin";
import { useAppShell } from "@/components/AppShellContext";

interface ChatMessage {
  id: string;
  wallet: string;
  chain: string;
  text: string;
  ts: number;
  pinned?: boolean;
}

const ALL_TRACK_IDS = ALBUMS.flatMap((a) => a.tracks.map((t) => t.id));

function truncate(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function timeShort(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function ChatPage() {
  const { chain, walletAddress, requestConnect } = useAppShell();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [tick, setTick] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);

  const isAdmin = isAdminWallet(walletAddress);
  const canPost = !!walletAddress && (isAdmin || ownsAnyEdition(chain, walletAddress, ALL_TRACK_IDS));

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

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

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

  async function removeMessage(id: string) {
    if (!walletAddress || !isAdmin) return;
    try {
      await fetch("/api/chat", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, wallet: walletAddress }),
      });
      await load();
    } catch {
      // best-effort
    }
  }

  async function togglePin(m: ChatMessage) {
    if (!walletAddress || !isAdmin) return;
    try {
      await fetch("/api/chat", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: m.id, wallet: walletAddress, pinned: !m.pinned }),
      });
      await load();
    } catch {
      // best-effort
    }
  }

  return (
    <div className="chat-page-wrap">
      <div className="aim-window">
        <div className="aim-titlebar">
          <span className="aim-titlebar-dot" />
          Member Chat
        </div>

        <div className="aim-log" ref={logRef}>
          {messages.length === 0 && (
            <div className="aim-empty">No messages yet — be the first to post.</div>
          )}
          {messages.map((m) => {
            const name = getNickname(m.wallet) ?? truncate(m.wallet);
            return (
              <div key={m.id} className={`aim-line${m.pinned ? " pinned" : ""}`}>
                {m.pinned && <span className="aim-line-pin-flag">PINNED</span>}
                <span className="aim-line-time">[{timeShort(m.ts)}]</span>{" "}
                <span className="aim-line-who">{name}:</span>{" "}
                <span className="aim-line-text">{m.text}</span>
                {isAdmin && (
                  <span className="aim-line-admin">
                    <button onClick={() => togglePin(m)} title={m.pinned ? "Unpin" : "Pin"}>
                      {m.pinned ? "Unpin" : "Pin"}
                    </button>
                    <button onClick={() => removeMessage(m.id)} title="Delete">
                      Delete
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div
          className={`aim-composer${!canPost ? " disabled" : ""}`}
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
          <button onClick={send} disabled={!canPost || sending || !draft.trim()}>
            {sending ? "…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
