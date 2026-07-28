"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { getNickname } from "@/lib/nicknames";
import { isAdminWallet } from "@/lib/admin";
import { useAppShell } from "@/components/AppShellContext";
import { NOTE_COLORS, DEFAULT_NOTE_COLOR, NoteColor } from "@/lib/boardColors";
import { useResolvedNames, truncateAddress } from "@/lib/useResolvedNames";
import { timeAgo, fullDateTime } from "@/lib/timeFormat";

interface BoardNote {
  id: string;
  wallet: string;
  chain: string;
  text: string;
  color: NoteColor;
  ts: number;
  pinned?: boolean;
}

const CHAIN_LABEL: Record<string, string> = {
  robinhood: "Robinhood",
  base: "Base",
  solana: "Solana",
};

// A handful of fixed tilt angles instead of Math.random() per render — keeps
// the pinned-note look stable across re-renders/re-fetches instead of every
// note jittering to a new angle each poll.
const TILTS = [-3, 2, -1.5, 3, -2.5, 1, -1, 2.5];

export default function BulletinBoard() {
  const { chain, walletAddress, requestConnect } = useAppShell();
  const [notes, setNotes] = useState<BoardNote[]>([]);
  const [configured, setConfigured] = useState(true);
  const [draft, setDraft] = useState("");
  const [color, setColor] = useState<NoteColor>(DEFAULT_NOTE_COLOR);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canPost = !!walletAddress;
  const names = useResolvedNames(notes.map((n) => n.wallet));

  async function load() {
    try {
      const res = await fetch("/api/board", { cache: "no-store" });
      const data = await res.json();
      setNotes(data.notes ?? []);
      setConfigured(data.configured !== false);
    } catch {
      // best-effort — same tolerance as the rest of this prototype's telemetry
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pin() {
    const text = draft.trim();
    if (!text || !walletAddress || posting) return;
    setPosting(true);
    setError(null);
    try {
      const res = await fetch("/api/board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: walletAddress, chain, text, color }),
      });
      const data = await res.json();
      if (res.ok) {
        setDraft("");
        await load();
      } else {
        setError(data.error ?? "Couldn't post — try again.");
      }
    } catch {
      setError("Couldn't post — try again.");
    } finally {
      setPosting(false);
    }
  }

  async function removeNote(id: string) {
    if (!walletAddress || !isAdminWallet(walletAddress)) return;
    try {
      await fetch("/api/board", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, wallet: walletAddress }),
      });
      await load();
    } catch {
      // best-effort
    }
  }

  async function toggleFeature(n: BoardNote) {
    if (!walletAddress || !isAdminWallet(walletAddress)) return;
    try {
      await fetch("/api/board", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: n.id, wallet: walletAddress, pinned: !n.pinned }),
      });
      await load();
    } catch {
      // best-effort
    }
  }

  return (
    <div className="board-wrap">
      <div className="board-head">
        <div className="board-eyebrow">Community</div>
        <h1>The Board</h1>
        <p className="board-sub">
          Pin a short note for the community. Rough v1 — later, notes will sort by how
          much $Dyl / how many editions the poster holds.
        </p>
      </div>

      <div className="board-composer">
        <textarea
          value={draft}
          maxLength={200}
          rows={2}
          placeholder={canPost ? "Pin a message…" : "Connect a wallet to post"}
          disabled={!canPost}
          onChange={(e) => setDraft(e.target.value)}
          onClick={() => {
            if (!walletAddress) requestConnect();
          }}
        />
        <div className="board-color-row">
          <span className="board-color-label">Note color</span>
          <div className="board-color-swatches">
            {NOTE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`board-color-swatch${color === c ? " active" : ""}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                aria-label={`Pick color ${c}`}
              />
            ))}
          </div>
        </div>
        <div className="board-composer-row">
          <span className="board-composer-count">{draft.length}/200</span>
          <button onClick={pin} disabled={!canPost || posting || !draft.trim()}>
            {posting ? "Pinning…" : "Pin it"}
          </button>
        </div>
        {error && <div className="board-error">{error}</div>}
        {!configured && (
          <div className="board-error">The board isn&apos;t configured on this deployment yet.</div>
        )}
      </div>

      <div className="corkboard">
        {notes.length === 0 && (
          <div className="board-empty">Nothing pinned yet — be the first.</div>
        )}
        {notes.map((n, i) => {
          const isDyl = isAdminWallet(n.wallet);
          const name = names[n.wallet] ?? getNickname(n.wallet) ?? truncateAddress(n.wallet);
          const tilt = TILTS[i % TILTS.length];
          return (
            <div
              key={n.id}
              className={`board-note${n.pinned ? " featured" : ""}`}
              style={{ "--tilt": `${tilt}deg`, "--note-bg": n.color } as React.CSSProperties}
            >
              <span className="board-note-pin" />
              {n.pinned && <span className="board-note-featured-flag">★ FEATURED</span>}
              <div className="board-note-text">{n.text}</div>
              <div className="board-note-foot">
                {isDyl && (
                  <Image src="/brand/dyl-pfp.png" alt="Dyl" width={14} height={14} className="board-note-avatar" />
                )}
                <span className="board-note-who">{name}</span>
                <span className="board-note-chain">{CHAIN_LABEL[n.chain] ?? n.chain}</span>
                <span className="board-note-date" title={fullDateTime(n.ts)}>
                  {timeAgo(n.ts)}
                </span>
              </div>
              {walletAddress && isAdminWallet(walletAddress) && (
                <div className="board-note-admin">
                  <button onClick={() => toggleFeature(n)} title={n.pinned ? "Unfeature" : "Feature at top"}>
                    {n.pinned ? "Unfeature" : "Feature"}
                  </button>
                  <button className="board-note-unpin" onClick={() => removeNote(n.id)} title="Remove (admin)">
                    ×
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
