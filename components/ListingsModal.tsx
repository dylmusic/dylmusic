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
  busy,
  error,
  onSetPrice,
  onCancelListing,
  onClose,
}: {
  track: Track;
  editions: EditionRow[];
  // Real list/cancel state (lib/useTrackCommerce.ts's sellBusy/sellError)
  // — only ever populated once the gate below is removed and
  // onSetPrice/onCancelListing actually run; harmless/unused while
  // "Not live yet" still fires first, same as BuyConfirmModal's `error`.
  busy?: boolean;
  error?: string | null;
  onSetPrice: (editionNumber: number, price: number) => void;
  onCancelListing: (editionNumber: number) => void;
  onClose: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  // Beta is live now (Dylan: "if anyone clicks confirm buy or confirm sell
  // on the NFTs, tell them its not live yet... let them see all the
  // interface, but at the last step let them know it doesnt work"). The
  // price input stays fully editable; only the final List click is gated,
  // and onSetPrice (the real simulated listing) is never reached anymore.
  const [notLive, setNotLive] = useState(false);

  function draftFor(row: EditionRow) {
    return drafts[row.editionNumber] ?? (row.listedPrice ?? track.priceUsd).toFixed(2);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        {notLive ? (
          <div className="modal-not-live">
            <div className="modal-not-live-icon">🚧</div>
            <h3>Not live yet</h3>
            <p>
              Listing NFTs for sale is not live yet — you are looking at the real beta
              interface, but the contracts behind it are not deployed. Nothing was listed.
            </p>
            <button className="buy-confirm-cta" onClick={onClose}>
              Got it
            </button>
          </div>
        ) : (
        <>
        <div className="modal-head">
          <div>
            <div className="modal-eyebrow">List for sale</div>
            <h3>{track.title}</h3>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {error && <div className="buy-confirm-error">{error}</div>}

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
                      disabled={busy}
                      onClick={() => onCancelListing(row.editionNumber)}
                    >
                      {busy ? "…" : "Cancel"}
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
                      disabled={busy}
                      onClick={() => {
                        const p = parseFloat(draftFor(row));
                        if (!isNaN(p) && p > 0) setNotLive(true);
                      }}
                    >
                      {busy ? "…" : "List"}
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}
