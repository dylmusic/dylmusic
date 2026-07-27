"use client";

import { useState } from "react";
import { Track } from "@/lib/albums";
import { HoldingRecord } from "@/lib/holdings";

export default function TrackRow({
  track,
  minted,
  holding,
  walletConnected,
  busy,
  onBuy,
  onConnect,
  onList,
  onCancelListing,
}: {
  track: Track;
  minted: number;
  holding: HoldingRecord | undefined;
  walletConnected: boolean;
  busy: boolean;
  onBuy: () => void;
  onConnect: () => void;
  onList: (price: number) => void;
  onCancelListing: () => void;
}) {
  const [listOpen, setListOpen] = useState(false);
  const [priceInput, setPriceInput] = useState(track.priceUsd.toFixed(2));

  const soldOut = minted >= track.editionCap;
  const owned = !!holding;

  return (
    <div className="track-row">
      <div className="track-num">{String(track.index).padStart(2, "0")}</div>

      <div className="track-info">
        <div className="track-title">{track.title}</div>
        <div className="track-edition">
          {owned ? (
            <span className="edition-owned">Edition #{holding!.editionNumber}</span>
          ) : (
            <span>
              {minted}/{track.editionCap} minted
            </span>
          )}
        </div>
      </div>

      <div className="track-action">
        {owned ? (
          holding!.listedPriceUsd != null ? (
            <div className="listing-active">
              <span>Listed ${holding!.listedPriceUsd.toFixed(2)}</span>
              <button className="btn-ghost" onClick={onCancelListing}>
                Cancel
              </button>
            </div>
          ) : listOpen ? (
            <div className="listing-form">
              <span className="listing-dollar">$</span>
              <input
                inputMode="decimal"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              />
              <button
                className="btn-sell"
                onClick={() => {
                  const p = parseFloat(priceInput);
                  if (!isNaN(p) && p > 0) {
                    onList(p);
                    setListOpen(false);
                  }
                }}
              >
                Sell
              </button>
            </div>
          ) : (
            <button className="btn-ghost" onClick={() => setListOpen(true)}>
              List for sale
            </button>
          )
        ) : soldOut ? (
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
      </div>
    </div>
  );
}
