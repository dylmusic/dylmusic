"use client";

import { useState } from "react";
import { ChainKey, Track, baselineMinted } from "@/lib/albums";
import {
  getOwnedEditions,
  getListings,
  localMintedCount,
  recordMint,
  setListingForEdition,
} from "@/lib/holdings";
import { recordActivity } from "@/lib/activity";
import ListingsModal from "./ListingsModal";

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function MiniPlayer({
  track,
  chain,
  walletAddress,
  isPlaying,
  currentTime,
  duration,
  onToggle,
  onClose,
  onRequestConnect,
  onSeek,
}: {
  track: Track;
  chain: ChainKey;
  walletAddress: string | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  onToggle: () => void;
  onClose: () => void;
  onRequestConnect: () => void;
  onSeek: (time: number) => void;
}) {
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const minted = Math.min(
    track.editionCap,
    baselineMinted(track, chain) + localMintedCount(chain, track.id)
  );
  const ownedEditions = walletAddress ? getOwnedEditions(chain, walletAddress, track.id) : [];
  const listings = walletAddress ? getListings(chain, walletAddress, track.id) : {};
  const soldOut = minted >= track.editionCap;
  void tick;

  const listedPrices = Object.values(listings);
  const sellDisplayPrice = listedPrices.length ? Math.min(...listedPrices) : track.priceUsd;

  async function buy() {
    if (!walletAddress) {
      onRequestConnect();
      return;
    }
    if (busy || soldOut) return;
    setBusy(true);
    await delay(450);
    const current = baselineMinted(track, chain) + localMintedCount(chain, track.id);
    if (current < track.editionCap) {
      recordMint(chain, walletAddress, track.id, current + 1);
      recordActivity({
        type: "buy",
        chain,
        wallet: walletAddress,
        trackTitle: track.title,
        editionNumber: current + 1,
        priceUsd: track.priceUsd,
      });
    }
    setBusy(false);
    setTick((n) => n + 1);
  }

  function setEditionPrice(editionNumber: number, price: number) {
    if (!walletAddress) return;
    setListingForEdition(chain, walletAddress, track.id, editionNumber, price);
    recordActivity({
      type: "sell",
      chain,
      wallet: walletAddress,
      trackTitle: track.title,
      editionNumber,
      priceUsd: price,
    });
    setTick((n) => n + 1);
  }

  function cancelEditionListing(editionNumber: number) {
    if (!walletAddress) return;
    setListingForEdition(chain, walletAddress, track.id, editionNumber, null);
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
              {ownedEditions.length > 0
                ? `You own ${ownedEditions.length}`
                : `${minted}/${track.editionCap} minted`}
            </span>
          </div>
        </div>

        <button className="mini-player-close" onClick={onClose} aria-label="Close player">
          ×
        </button>
      </div>

      <div
        className="mini-player-seek"
        onClick={(e) => {
          if (!duration) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
          onSeek(ratio * duration);
        }}
      >
        <div className="mini-player-seek-track">
          <div
            className="mini-player-seek-fill"
            style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
          />
          <div
            className="mini-player-seek-thumb"
            style={{ left: `${duration ? (currentTime / duration) * 100 : 0}%` }}
          />
        </div>
        <div className="mini-player-seek-times">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      <div className="mini-player-actions">
        {soldOut ? (
          <button className="btn-buy" disabled>
            Sold Out
          </button>
        ) : !walletAddress ? (
          <button className="btn-buy" onClick={onRequestConnect}>
            Connect
          </button>
        ) : (
          <button className="btn-buy" onClick={buy} disabled={busy}>
            {busy ? "Buying…" : `Buy $${track.priceUsd.toFixed(2)}`}
          </button>
        )}

        <button
          className="btn-sell"
          onClick={() => (walletAddress ? setModalOpen(true) : onRequestConnect())}
        >
          Sell ${sellDisplayPrice.toFixed(2)}
        </button>
      </div>

      {modalOpen && (
        <ListingsModal
          track={track}
          editions={ownedEditions.map((editionNumber) => ({
            editionNumber,
            listedPrice: listings[editionNumber] ?? null,
          }))}
          onSetPrice={setEditionPrice}
          onCancelListing={cancelEditionListing}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}
