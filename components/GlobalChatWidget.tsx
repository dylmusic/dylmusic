"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { ALBUMS } from "@/lib/albums";
import { ownsAnyEdition } from "@/lib/holdings";
import { getNickname } from "@/lib/nicknames";
import { isAdminWallet } from "@/lib/admin";
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

function truncate(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function timeShort(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

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
  const canPost = !!address && (isAdmin || ownsAnyEdition("robinhood", address, ALL_TRACK_IDS));

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
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: address, chain: "robinhood", text }),
      });
      if (res.ok) {
        setDraft("");
        await load();
      }
    } catch {
      // best-effort
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
          const name = getNickname(m.wallet) ?? truncate(m.wallet);
          return (
            <div key={m.id} className={`gcw-line${m.pinned ? " pinned" : ""}`}>
              {m.pinned && <span className="aim-line-pin-flag">PINNED</span>}
              <span className="gcw-line-time">[{timeShort(m.ts)}]</span>{" "}
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
