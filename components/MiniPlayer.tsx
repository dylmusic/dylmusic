"use client";

import { useState } from "react";
import { ChainKey, Track, baselineMinted } from "@/lib/albums";
import {
  getHolding,
  getListingPrice,
  localMintedCount,
  recordMint,
  setListingPrice,
} from "@/lib/holdings";

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

export default function MiniPlayer({
  track,
  chain,
  walletAddress,
  isPlaying,
  onToggle,
  onClose,
  onRequestConnect,
}: {
  track: Track;
  chain: ChainKey;
  walletAddress: string | null;
  isPlaying: boolean;
  onToggle: () => void;
  onClose: () => void;
  onRequestConnect: () => void;
}) {
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [priceInput, setPriceInput] = useState(track.priceUsd.toFixed(2));

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const minted = Math.min(
    track.editionCap,
    baselineMinted(track, chain) + localMintedCount(chain, track.id)
  );
  const holding = walletAddress ? getHolding(chain, walletAddress, track.id) : undefined;
  const listedPrice = walletAddress ? getListingPrice(chain, walletAddress, track.id) : undefined;
  const soldOut = minted >= track.editionCap;
  const owned = !!holding;
  void tick;

  async function buy() {
    if (!walletAddress) {
      onRequestConnect();
      return;
    }
    if (busy || owned || soldOut) return;
    setBusy(true);
    await delay(450);
    const current = baselineMinted(track, chain) + localMintedCount(chain, track.id);
    if (current < track.editionCap) {
      recordMint(chain, walletAddress, track.id, current + 1);
    }
    setBusy(false);
    setTick((n) => n + 1);
  }

  function confirmSell() {
    if (!walletAddress) {
      onRequestConnect();
      return;
    }
    const p = parseFloat(priceInput);
    if (!isNaN(p) && p > 0) {
      setListingPrice(chain, walletAddress, track.id, p);
      setTick((n) => n + 1);
    }
  }

  function cancelListing() {
    if (!walletAddress) return;
    setListingPrice(chain, walletAddress, track.id, null);
    setTick((n) => n + 1);
  }

  return (
    <div className="mini-player">
      <div className="mini-player-top">
        <button
          className="mini-player-toggle"
          onClick={onToggle}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <svg width="16" height="16" viewBox="0 0 14 14" fill="currentColor">
              <rect x="2" y="1" width="4" height="12" rx="1" />
              <rect x="8" y="1" width="4" height="12" rx="1" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 14 14" fill="currentColor">
              <path d="M2.5 1.2c0-.9 1-1.4 1.7-.9l9 5.8c.7.4.7 1.4 0 1.8l-9 5.8c-.7.5-1.7 0-1.7-.9V1.2Z" />
            </svg>
          )}
        </button>

        <div className="mini-player-info">
          <span className={`track-eq mini${isPlaying ? " playing" : ""}`}>
            <span />
            <span />
            <span />
          </span>
          <div className="mini-player-text">
            <span className="mini-player-title">{track.title}</span>
            <span className="mini-player-sub">
              {owned ? `Edition #${holding!.editionNumber}` : `${minted}/${track.editionCap} minted`}
            </span>
          </div>
        </div>

        <button className="mini-player-close" onClick={onClose} aria-label="Close player">
          ×
        </button>
      </div>

      <div className="mini-player-actions">
        {soldOut && !owned ? (
          <button className="btn-buy" disabled>
            Sold Out
          </button>
        ) : !walletAddress ? (
          <button className="btn-buy" onClick={onRequestConnect}>
            Connect
          </button>
        ) : (
          <button className="btn-buy" onClick={buy} disabled={busy || owned}>
            {busy ? "Buying…" : owned ? `Owned #${holding!.editionNumber}` : `Buy $${track.priceUsd.toFixed(2)}`}
          </button>
        )}

        {listedPrice != null ? (
          <button className="btn-sell listed" onClick={cancelListing}>
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
