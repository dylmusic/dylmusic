"use client";

import { Fragment, useEffect, useState } from "react";
import type { Track } from "@/lib/albums";
import type { OrderBookEntry } from "@/lib/orderbook";
import { CURATED_TOKENS, PINNED_TOKENS, SWAP_CHAINS } from "@/lib/dylTokens";
import type { DylToken } from "@/lib/dylTokens";
import type { PayStep } from "@/lib/payWithAnyToken";
import TokenPickerModal, { TokenIcon } from "./TokenPickerModal";
import { unlockSuccessSound } from "@/lib/successSound";

const ALL_PINNED = [...PINNED_TOKENS.robinhood, ...PINNED_TOKENS.base, ...PINNED_TOKENS.solana, ...PINNED_TOKENS.ethereum];

// "Buy" confirms which currency to pay with (defaulting to the chain's
// native asset) before doing so, letting the buyer switch to any chain/token
// the real Swap page itself supports. Choosing a non-native currency runs
// the real swap-then-purchase engine (lib/payWithAnyToken.ts's
// runPayWithAnyToken, already wired into lib/useTrackCommerce.ts's
// confirmPendingBuy) before the final mint/buy call.

export default function BuyConfirmModal({
  track,
  entry,
  quantity,
  album,
  defaultPayToken,
  buyStep,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  track?: Track;
  entry?: OrderBookEntry;
  quantity: number;
  // Whole-album buy (Dylan: "when they buy an album, it still needs the buy
  // button popup interface... that's going to execute a multi-buy for all
  // 19 items at once") — one confirm/pay-with step covering every track in
  // the album at once, instead of the modal's usual single-track display.
  // Real contract implication (see CLAUDE.md): this is NOT the same shape
  // as ERC721A's own mint(quantity) batch optimization, which only compresses
  // storage across sequential ids under one track's own id range — an album
  // buy mints across 19 DIFFERENT non-sequential ranges (one per track) in
  // one wallet action, closer to a custom multicall than a single batch mint.
  album?: { title: string; trackCount: number; totalUsd: number };
  defaultPayToken: DylToken;
  buyStep: PayStep;
  busy: boolean;
  // Real purchase failure (lib/useTrackCommerce.ts / AlbumView.tsx's
  // confirmBuyAlbum).
  error?: string | null;
  onConfirm: (payToken: DylToken) => void;
  onCancel: () => void;
}) {
  const [payToken, setPayToken] = useState<DylToken>(defaultPayToken);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    setPayToken(defaultPayToken);
  }, [defaultPayToken, track?.id, album?.title]);

  const isNative =
    payToken.chainId === defaultPayToken.chainId && payToken.address === defaultPayToken.address;

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        {buyStep !== null ? (
          <div className="buy-confirm-waiting">
            <div className="buy-confirm-ring" />
            <div className="buy-confirm-waiting-title">
              {buyStep.part === buyStep.total
                ? album
                  ? `Minting ${album.trackCount} tracks`
                  : quantity > 1
                    ? `Minting ${quantity} editions`
                    : "Buying edition"
                : buyStep.label}
            </div>
            <div className="buy-confirm-waiting-sub">
              Step {buyStep.part} of {buyStep.total}
            </div>
            <div className="buy-confirm-dots">
              {Array.from({ length: buyStep.total }, (_, i) => i + 1).map((n) => (
                <Fragment key={n}>
                  {n > 1 && <span className={`buy-confirm-step-line${buyStep!.part >= n ? " active" : ""}`} />}
                  <span className={`buy-confirm-dot${buyStep!.part >= n ? " done" : ""}`} />
                </Fragment>
              ))}
            </div>
          </div>
        ) : (
          <div className="buy-confirm-body">
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow">Confirm purchase</div>
                <h3>{album ? album.title : track!.title}</h3>
              </div>
              <button className="modal-close" onClick={onCancel} aria-label="Close">
                ×
              </button>
            </div>

            <div className="buy-confirm-track">
              <span className="buy-confirm-track-title">
                {album
                  ? `MINTING: ${album.trackCount} TRACK${album.trackCount === 1 ? "" : "S"}`
                  : entry!.type === "mint"
                    ? quantity > 1
                      ? `MINTING: ${quantity} EDITIONS (#${track!.editionCap - (entry!.remaining ?? 0) + 1}–#${
                          track!.editionCap - (entry!.remaining ?? 0) + quantity
                        })`
                      : `MINTING: EDITION #${track!.editionCap - (entry!.remaining ?? 0) + 1}`
                    : `PURCHASE: EDITION #${entry!.editionNumber}`}
              </span>
              <span className="buy-confirm-track-price">
                ${album ? album.totalUsd.toFixed(2) : (entry!.priceUsd * quantity).toFixed(2)}
              </span>
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

            {error && <div className="buy-confirm-error">{error}</div>}

            <button
              className="buy-confirm-cta"
              disabled={busy}
              onClick={() => {
                // Must happen synchronously in this real click handler —
                // the success chime plays later, after several async
                // awaits, by which point browsers would otherwise block a
                // freshly-created AudioContext. See lib/successSound.ts.
                unlockSuccessSound();
                onConfirm(payToken);
              }}
            >
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
