"use client";

import { Track } from "@/lib/albums";
import { formatStreams, getStreamCount } from "@/lib/streams";

export default function TrackRow({
  track,
  minted,
  ownedEditions,
  listings,
  walletConnected,
  busy,
  isPlaying,
  isActive,
  onTogglePlay,
  onBuy,
  onConnect,
  onOpenSellModal,
}: {
  track: Track;
  minted: number;
  ownedEditions: number[];
  listings: Record<number, number>;
  walletConnected: boolean;
  busy: boolean;
  isPlaying: boolean;
  isActive: boolean;
  onTogglePlay: () => void;
  onBuy: () => void;
  onConnect: () => void;
  onOpenSellModal: () => void;
}) {
  const soldOut = minted >= track.editionCap;
  const ownedCount = ownedEditions.length;
  const pct = Math.round((minted / track.editionCap) * 100);

  const listedPrices = Object.values(listings);
  const sellDisplayPrice = listedPrices.length ? Math.min(...listedPrices) : track.priceUsd;

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
          {ownedCount > 0 ? (
            <span className="edition-owned">
              You own {ownedCount} {ownedCount === 1 ? "edition" : "editions"}
              {listedPrices.length > 0 ? ` · ${listedPrices.length} listed` : ""}
            </span>
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
            <path d="M2.5 1.5v9l7-4.5-7-4.5Z" fill="currentColor" />
          </svg>
          {formatStreams(getStreamCount(track))}
        </span>
        {soldOut ? (
          <button className="btn-buy" disabled>
            Sold Out
          </button>
        ) : !walletConnected ? (
          <button className="btn-buy" onClick={onConnect}>
            Connect
          </button>
        ) : (
          <button className="btn-buy" onClick={onBuy} disabled={busy}>
            {busy ? "Buying…" : `Buy $${track.priceUsd.toFixed(2)}`}
          </button>
        )}

        <button className="btn-sell" onClick={walletConnected ? onOpenSellModal : onConnect}>
          Sell ${sellDisplayPrice.toFixed(2)}
        </button>
      </div>
    </div>
  );
}
