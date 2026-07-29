"use client";

import { Track } from "@/lib/albums";
import { formatStreams, getStreamCount } from "@/lib/streams";
import { OrderBookEntry } from "@/lib/orderbook";

export default function TrackRow({
  track,
  minted,
  ownedEditions,
  listings,
  book,
  walletConnected,
  busy,
  isPlaying,
  isActive,
  onTogglePlay,
  onBuyFloor,
  onOpenOrderBook,
  onConnect,
  onOpenSellModal,
}: {
  track: Track;
  minted: number;
  ownedEditions: number[];
  listings: Record<number, number>;
  book: OrderBookEntry[];
  walletConnected: boolean;
  busy: boolean;
  isPlaying: boolean;
  isActive: boolean;
  onTogglePlay: () => void;
  onBuyFloor: () => void;
  onOpenOrderBook: () => void;
  onConnect: () => void;
  onOpenSellModal: () => void;
}) {
  const ownedCount = ownedEditions.length;
  const pct = Math.round((minted / track.editionCap) * 100);
  const floor = book[0] ?? null;

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
        <span className={`track-play-btn${isActive ? " active" : ""}`}>
          {isActive && isPlaying ? (
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <rect x="2" y="1.5" width="3" height="9" rx="1" fill="currentColor" />
              <rect x="7" y="1.5" width="3" height="9" rx="1" fill="currentColor" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 1.5v9l7-4.5-7-4.5Z" fill="currentColor" />
            </svg>
          )}
        </span>
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
              {book.length > 1 ? ` · ${book.length} asks` : ""}
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

        {!floor ? (
          <button className="btn-buy" disabled>
            Sold Out
          </button>
        ) : !walletConnected ? (
          <button className="btn-buy" onClick={onConnect}>
            Connect
          </button>
        ) : (
          <div className="btn-buy-split">
            <button className="btn-buy" onClick={onBuyFloor} disabled={busy}>
              {busy ? "Buying…" : `Buy $${floor.priceUsd.toFixed(2)}`}
            </button>
            <button
              className="btn-buy-expand"
              onClick={onOpenOrderBook}
              title="View order book"
              aria-label="View order book"
            >
              <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                <path d="M1 3l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        )}

        <button className="btn-sell" onClick={walletConnected ? onOpenSellModal : onConnect}>
          Sell ${sellDisplayPrice.toFixed(2)}
        </button>
      </div>
    </div>
  );
}
