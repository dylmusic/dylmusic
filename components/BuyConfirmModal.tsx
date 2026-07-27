"use client";

import { useEffect, useState } from "react";
import type { Track } from "@/lib/albums";
import type { OrderBookEntry } from "@/lib/orderbook";
import { CURATED_TOKENS, PINNED_TOKENS, SWAP_CHAINS } from "@/lib/dylTokens";
import type { DylToken } from "@/lib/dylTokens";
import TokenPickerModal, { TokenIcon } from "./TokenPickerModal";

const ALL_PINNED = [...PINNED_TOKENS.robinhood, ...PINNED_TOKENS.base, ...PINNED_TOKENS.solana];

// "Buy" no longer purchases instantly — this confirms which currency to pay
// with (defaulting to the chain's native asset) before doing so, letting the
// buyer switch to any chain/token the real Swap page itself supports. Until
// real NFT contracts are live, none of this actually moves funds — choosing
// a non-native currency just plays a cosmetic "swap, then buy" 1/2 -> 2/2
// animation instead of a real swap-then-purchase.

export default function BuyConfirmModal({
  track,
  entry,
  defaultPayToken,
  buyStep,
  busy,
  onConfirm,
  onCancel,
}: {
  track: Track;
  entry: OrderBookEntry;
  defaultPayToken: DylToken;
  buyStep: 1 | 2 | null;
  busy: boolean;
  onConfirm: (payToken: DylToken) => void;
  onCancel: () => void;
}) {
  const [payToken, setPayToken] = useState<DylToken>(defaultPayToken);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    setPayToken(defaultPayToken);
  }, [defaultPayToken, track.id]);

  const isNative =
    payToken.chainId === defaultPayToken.chainId && payToken.address === defaultPayToken.address;

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        {buyStep !== null ? (
          <div className="buy-confirm-waiting">
            <div className="buy-confirm-ring" />
            <div className="buy-confirm-waiting-title">
              {buyStep === 1 ? `Swapping ${payToken.symbol} to ${defaultPayToken.symbol}` : "Buying edition"}
            </div>
            <div className="buy-confirm-waiting-sub">Step {buyStep} of 2</div>
            <div className="buy-confirm-dots">
              <span className={`buy-confirm-dot${buyStep >= 1 ? " done" : ""}`} />
              <span className={`buy-confirm-dot${buyStep >= 2 ? " done" : ""}`} />
            </div>
          </div>
        ) : (
          <div className="buy-confirm-body">
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow">Confirm purchase</div>
                <h3>{track.title}</h3>
              </div>
              <button className="modal-close" onClick={onCancel} aria-label="Close">
                ×
              </button>
            </div>

            <div className="buy-confirm-track">
              <span className="buy-confirm-track-title">
                {entry.type === "mint"
                  ? `MINTING: EDITION #${track.editionCap - (entry.remaining ?? 0) + 1}`
                  : `PURCHASE: EDITION #${entry.editionNumber}`}
              </span>
              <span className="buy-confirm-track-price">${entry.priceUsd.toFixed(2)}</span>
            </div>

            <div>
              <div className="buy-confirm-pay-label">Pay With</div>
              <button className="swap-token-pill-wrap" onClick={() => setPickerOpen(true)}>
                <span className="swap-token-pill">
                  <span className="swap-token-pill-icon">
                    <TokenIcon token={payToken} size={18} />
                  </span>
                  {payToken.symbol}
                  <span className="swap-token-caret">▾</span>
                </span>
              </button>
              {!isNative && (
                <div className="swap-route-note">
                  Swaps {payToken.symbol} ({SWAP_CHAINS.find((c) => c.id === payToken.chainId)?.name}) to{" "}
                  {defaultPayToken.symbol} first, then buys.
                </div>
              )}
            </div>

            <button className="buy-confirm-cta" disabled={busy} onClick={() => onConfirm(payToken)}>
              {busy ? "Confirming…" : "Confirm Buy"}
            </button>
          </div>
        )}
      </div>

      <TokenPickerModal
        open={pickerOpen}
        chainId={payToken.chainId}
        tokens={CURATED_TOKENS}
        pinnedTokens={ALL_PINNED}
        chains={SWAP_CHAINS}
        onClose={() => setPickerOpen(false)}
        onSelect={setPayToken}
      />
    </div>
  );
}
