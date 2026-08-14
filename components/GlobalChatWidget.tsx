"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { ALBUMS } from "@/lib/albums";
import { useOwnsAnyEdition } from "@/lib/useOwnsAnyEdition";
import { getNickname } from "@/lib/nicknames";
import { isAdminWallet } from "@/lib/admin";
import { useResolvedNames, truncateAddress } from "@/lib/useResolvedNames";
import { timeAgo, fullDateTime } from "@/lib/timeFormat";
import { usePlayer } from "./PlayerContext";

interface ChatMessage {
  id: string;
  wallet: string;
  chain: string;
  text: string;
  ts: number;
  pinned?: boolean;
}

const ALL_TRACK_IDS = ALBUMS.flatMap((a) => a.tracks.map((t) => t.id));

// A persistent, dockable chat — collapsed to a thin tab bottom-right on
// every page (Dylan: "the chat is always in the bottom right... collapsed
// into just a line unless you click it"), sitting above the MiniPlayer
// instead of overlapping it when a track's playing. Reuses the exact same
// /api/chat store as the full /chat page (same messages, same edition-gate
// via ownsAnyEdition) — this is a quick-access dock, not a second inbox, so
// it hides itself on /chat to avoid showing the same thing twice.
export default function GlobalChatWidget() {
  const pathname = usePathname();
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const player = usePlayer();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const isAdmin = isAdminWallet(address);
  const ownsEdition = useOwnsAnyEdition("robinhood", address ?? null, ALL_TRACK_IDS);
  const canPost = !!address && (isAdmin || ownsEdition);
  const names = useResolvedNames(messages.map((m) => m.wallet));

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
    if (!open) return;
    load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  async function send() {
    const text = draft.trim();
    if (!text || !address || sending) return;
    setSending(true);
    setDraft("");
    // Optimistic append — was waiting on a full POST round-trip AND then a
    // full GET reload of all 100 messages before the sender's own message
    // ever appeared, which is what made posting feel "extremely slow."
    // Show it immediately with a temp id, then reconcile with the real
    // server-created message (POST already returns it) once that resolves
    // in the background — no second fetch needed on the happy path.
    const optimisticId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimisticMessage: ChatMessage = { id: optimisticId, wallet: address, chain: "robinhood", text, ts: Date.now() };
    setMessages((prev) => [...prev, optimisticMessage]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: address, chain: "robinhood", text }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        const real: ChatMessage | undefined = data?.message;
        if (real) setMessages((prev) => prev.map((m) => (m.id === optimisticId ? real : m)));
      } else {
        // Actually rejected (banned wallet, message too long, etc.) — don't
        // leave a message on screen that was never really posted, and give
        // the text back so nothing the user typed is lost.
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        setDraft(text);
      }
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setDraft(text);
    } finally {
      setSending(false);
    }
  }

  async function removeMessage(id: string) {
    if (!address || !isAdmin) return;
    try {
      await fetch("/api/chat", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, wallet: address }),
      });
      await load();
    } catch {
      // best-effort
    }
  }

  async function togglePin(m: ChatMessage) {
    if (!address || !isAdmin) return;
    try {
      await fetch("/api/chat", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: m.id, wallet: address, pinned: !m.pinned }),
      });
      await load();
    } catch {
      // best-effort
    }
  }

  if (pathname === "/chat") return null;

  const liftForPlayer = player.playingTrack ? "gcw-lifted" : "";

  if (!open) {
    return (
      <button className={`gcw-tab ${liftForPlayer}`} onClick={() => setOpen(true)}>
        <span className="gcw-tab-dot" />
        Chat
      </button>
    );
  }

  return (
    <div className={`gcw-window ${liftForPlayer}`}>
      <div className="gcw-titlebar" onClick={() => setOpen(false)}>
        <span className="gcw-titlebar-label">
          <span className="gcw-tab-dot" /> Chat
        </span>
        <button className="gcw-collapse" onClick={() => setOpen(false)} aria-label="Collapse chat">
          <svg width="7" height="7" viewBox="0 0 8 8">
            <path d="M1 1l6 6M7 1l-6 6" stroke="#04140a" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="gcw-log" ref={logRef}>
        {messages.length === 0 && <div className="gcw-empty">No messages yet — be the first to post.</div>}
        {messages.map((m) => {
          const isDyl = isAdminWallet(m.wallet);
          const name = names[m.wallet] ?? getNickname(m.wallet) ?? truncateAddress(m.wallet);
          return (
            <div key={m.id} className={`gcw-line${m.pinned ? " pinned" : ""}`}>
              {m.pinned && <span className="aim-line-pin-flag">PINNED</span>}
              <span className="gcw-line-time" title={fullDateTime(m.ts)}>
                [{timeAgo(m.ts)}]
              </span>{" "}
              {isDyl && (
                <Image src="/brand/dyl-pfp-avatar.png" alt="Dyl" width={16} height={16} className="gcw-line-avatar" />
              )}
              <span className="gcw-line-who">{name}:</span> <span className="gcw-line-text">{m.text}</span>
              {isAdmin && (
                <span className="aim-line-admin">
                  <button onClick={() => togglePin(m)}>{m.pinned ? "Unpin" : "Pin"}</button>
                  <button onClick={() => removeMessage(m.id)}>Delete</button>
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div
        className={`gcw-composer${!canPost ? " disabled" : ""}`}
        onClick={() => {
          if (!address) openConnectModal?.();
        }}
      >
        <input
          value={draft}
          maxLength={500}
          placeholder={canPost ? "Say something…" : "Hold a Dyl NFT to chat"}
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
  );
}
