"use client";

import { useState } from "react";
import { Track } from "@/lib/albums";

export interface EditionRow {
  editionNumber: number;
  listedPrice: number | null;
}

export default function ListingsModal({
  track,
  editions,
  onSetPrice,
  onCancelListing,
  onClose,
}: {
  track: Track;
  editions: EditionRow[];
  onSetPrice: (editionNumber: number, price: number) => void;
  onCancelListing: (editionNumber: number) => void;
  onClose: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  function draftFor(row: EditionRow) {
    return drafts[row.editionNumber] ?? (row.listedPrice ?? track.priceUsd).toFixed(2);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-eyebrow">List for sale</div>
            <h3>{track.title}</h3>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {editions.length === 0 ? (
          <div className="modal-empty">
            You don&apos;t own an edition of this track on this chain yet — buy
            one first, then it&apos;ll show up here to list.
          </div>
        ) : (
          <div className="modal-editions">
            {editions.map((row) => (
              <div key={row.editionNumber} className="modal-edition-row">
                <span className="modal-edition-num">#{row.editionNumber}</span>

                {row.listedPrice != null ? (
                  <>
                    <span className="modal-listed-price">
                      Listed at ${row.listedPrice.toFixed(2)}
                    </span>
                    <button
                      className="btn-ghost"
                      onClick={() => onCancelListing(row.editionNumber)}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className="modal-price-input">
                      <span>$</span>
                      <input
                        inputMode="decimal"
                        value={draftFor(row)}
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [row.editionNumber]: e.target.value }))
                        }
                      />
                    </span>
                    <button
                      className="btn-sell"
                      onClick={() => {
                        const p = parseFloat(draftFor(row));
                        if (!isNaN(p) && p > 0) onSetPrice(row.editionNumber, p);
                      }}
                    >
                      List
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
