"use client";

import { useState } from "react";
import { Track } from "@/lib/albums";
import { HoldingRecord } from "@/lib/holdings";
import { formatStreams, getStreamCount } from "@/lib/streams";

export default function TrackRow({
  track,
  minted,
  holding,
  listedPrice,
  walletConnected,
  busy,
  isPlaying,
  isActive,
  onTogglePlay,
  onBuy,
  onConnect,
  onList,
  onCancelListing,
}: {
  track: Track;
  minted: number;
  holding: HoldingRecord | undefined;
  listedPrice: number | undefined;
  walletConnected: boolean;
  busy: boolean;
  isPlaying: boolean;
  isActive: boolean;
  onTogglePlay: () => void;
  onBuy: () => void;
  onConnect: () => void;
  onList: (price: number) => void;
  onCancelListing: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [priceInput, setPriceInput] = useState(track.priceUsd.toFixed(2));

  const soldOut = minted >= track.editionCap;
  const owned = !!holding;
  const pct = Math.round((minted / track.editionCap) * 100);

  function confirmSell() {
    if (!walletConnected) {
      onConnect();
      return;
    }
    const p = parseFloat(priceInput);
    if (!isNaN(p) && p > 0) {
      onList(p);
    }
  }

  return (
    <div
      className={`track-row${isActive ? " active" : ""}`}
      onClick={onTogglePlay}
      role="button"
      tabIndex={0}
      aria-label={`Play ${track.title}`}
    >
      <div className="track-num">
        {isActive ? (
          <span className={`track-eq${isPlaying ? " playing" : ""}`}>
            <span />
            <span />
            <span />
          </span>
        ) : (
          String(track.index).padStart(2, "0")
        )}
      </div>

      <div className="track-info">
        <div className="track-title">{track.title}</div>
        <div className="track-edition">
          {owned ? (
            <span className="edition-owned">Edition #{holding!.editionNumber}</span>
          ) : (
            <span>
              {minted}/{track.editionCap} minted · {pct}% sold
            </span>
          )}
        </div>
      </div>

      <div className="track-actions" onClick={(e) => e.stopPropagation()}>
        <span className="track-streams" title="Streams">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path
              d="M2.5 1.5v9l7-4.5-7-4.5Z"
              fill="currentColor"
            />
          </svg>
          {formatStreams(getStreamCount(track))}
        </span>
        {soldOut && !owned ? (
          <button className="btn-buy" disabled>
            Sold Out
          </button>
        ) : !walletConnected ? (
          <button className="btn-buy" onClick={onConnect}>
            Connect
          </button>
        ) : (
          <button className="btn-buy" onClick={onBuy} disabled={busy || owned}>
            {busy ? "Buying…" : owned ? `Owned #${holding!.editionNumber}` : `Buy $${track.priceUsd.toFixed(2)}`}
          </button>
        )}

        {listedPrice != null ? (
          <button className="btn-sell listed" onClick={onCancelListing}>
            Listed ${listedPrice.toFixed(2)} · Cancel
          </button>
        ) : (
          <button
            className="btn-sell"
            onClick={(e) => {
              const target = e.target as HTMLElement;
              if (target.closest(".sell-price")) return;
              confirmSell();
            }}
          >
            Sell{" "}
            <span
              className="sell-price"
              onClick={(e) => {
                e.stopPropagation();
                setEditing(true);
              }}
            >
              {editing ? (
                <input
                  autoFocus
                  inputMode="decimal"
                  value={priceInput}
                  onChange={(e) => setPriceInput(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={() => setEditing(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setEditing(false);
                      confirmSell();
                    }
                  }}
                />
              ) : (
                `$${priceInput}`
              )}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
