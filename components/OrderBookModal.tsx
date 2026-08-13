"use client";

import { useState } from "react";
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
  onBuyMint: (quantity: number) => void;
  onBuyResale: (entry: OrderBookEntry) => void;
  onClose: () => void;
}) {
  // Quantity only applies to the mint row — minting N fresh sequential
  // editions in one action ("mint 10 copies at once"). A resale row is one
  // specific already-numbered edition, nothing to multiply there.
  const [mintQty, setMintQty] = useState(1);
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
              const isMint = entry.type === "mint";
              const remaining = entry.remaining ?? 1;
              const qty = isMint ? Math.min(mintQty, remaining) : 1;
              return (
                <div key={entryKey} className="book-row">
                  <span className="book-row-rank">{i === 0 ? "FLOOR" : `#${i + 1}`}</span>
                  <span className="book-row-label">
                    {isMint ? (
                      <>
                        Mint
                        <span className="book-row-sub">{entry.remaining} remaining</span>
                      </>
                    ) : (
                      <>
                        Edition #{entry.editionNumber}
                        <span className="book-row-sub">{truncate(entry.seller!)}</span>
                      </>
                    )}
                  </span>
                  {isMint && remaining > 1 ? (
                    <div className="book-row-qty">
                      <button
                        type="button"
                        disabled={isBusy || qty <= 1}
                        onClick={() => setMintQty((q) => Math.max(1, Math.min(remaining, q) - 1))}
                        aria-label="Fewer editions"
                      >
                        −
                      </button>
                      <span>{qty}</span>
                      <button
                        type="button"
                        disabled={isBusy || qty >= remaining}
                        onClick={() => setMintQty((q) => Math.min(remaining, q + 1))}
                        aria-label="More editions"
                      >
                        +
                      </button>
                    </div>
                  ) : (
                    <span />
                  )}
                  <span className="book-row-price">${(entry.priceUsd * qty).toFixed(2)}</span>
                  <button
                    className="btn-buy"
                    disabled={isBusy}
                    onClick={() => (isMint ? onBuyMint(qty) : onBuyResale(entry))}
                  >
                    {isBusy ? "Buying…" : qty > 1 ? `Buy ${qty}` : "Buy"}
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
