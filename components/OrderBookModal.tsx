"use client";

import { Track } from "@/lib/albums";
import { OrderBookEntry } from "@/lib/orderbook";

function truncate(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function OrderBookModal({
  track,
  book,
  busyKey,
  onBuyMint,
  onBuyResale,
  onClose,
}: {
  track: Track;
  book: OrderBookEntry[];
  busyKey: string | null;
  onBuyMint: () => void;
  onBuyResale: (entry: OrderBookEntry) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-eyebrow">Order book</div>
            <h3>{track.title}</h3>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {book.length === 0 ? (
          <div className="modal-empty">Sold out — no editions minted or listed yet.</div>
        ) : (
          <div className="modal-editions">
            {book.map((entry, i) => {
              const entryKey = entry.type === "mint" ? "mint" : `${entry.editionNumber}`;
              const isBusy = busyKey === entryKey;
              return (
                <div key={entryKey} className="book-row">
                  <span className="book-row-rank">{i === 0 ? "FLOOR" : `#${i + 1}`}</span>
                  <span className="book-row-label">
                    {entry.type === "mint" ? (
                      <>
                        Mint · new edition
                        <span className="book-row-sub">{entry.remaining} remaining</span>
                      </>
                    ) : (
                      <>
                        Edition #{entry.editionNumber}
                        <span className="book-row-sub">{truncate(entry.seller!)}</span>
                      </>
                    )}
                  </span>
                  <span className="book-row-price">${entry.priceUsd.toFixed(2)}</span>
                  <button
                    className="btn-buy"
                    disabled={isBusy}
                    onClick={() => (entry.type === "mint" ? onBuyMint() : onBuyResale(entry))}
                  >
                    {isBusy ? "Buying…" : "Buy"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
