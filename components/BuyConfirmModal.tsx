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
  quantity,
  album,
  defaultPayToken,
  buyStep,
  busy,
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
  buyStep: 1 | 2 | null;
  busy: boolean;
  onConfirm: (payToken: DylToken) => void;
  onCancel: () => void;
}) {
  const [payToken, setPayToken] = useState<DylToken>(defaultPayToken);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Beta is live now (Dylan: "if anyone clicks confirm buy or confirm sell
  // on the NFTs, tell them its not live yet... let them see all the
  // interface, but at the last step let them know it doesnt work"). The
  // whole flow — Pay With, token picker, price — stays fully explorable;
  // only this final click is gated, and onConfirm (the actual simulated
  // mint) is never reached anymore.
  const [notLive, setNotLive] = useState(false);

  useEffect(() => {
    setPayToken(defaultPayToken);
  }, [defaultPayToken, track?.id, album?.title]);

  const isNative =
    payToken.chainId === defaultPayToken.chainId && payToken.address === defaultPayToken.address;

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        {notLive ? (
          <div className="modal-not-live">
            <div className="modal-not-live-icon">🚧</div>
            <h3>Not live yet</h3>
            <p>
              NFT buying is not live yet — you are looking at the real beta interface, but the
              contracts behind it are not deployed. Nothing was charged.
            </p>
            <button className="buy-confirm-cta" onClick={onCancel}>
              Got it
            </button>
          </div>
        ) : buyStep !== null ? (
          <div className="buy-confirm-waiting">
            <div className="buy-confirm-ring" />
            <div className="buy-confirm-waiting-title">
              {buyStep === 1
                ? `Swapping ${payToken.symbol} to ${defaultPayToken.symbol}`
                : album
                  ? `Minting ${album.trackCount} tracks`
                  : quantity > 1
                    ? `Minting ${quantity} editions`
                    : "Buying edition"}
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

            {/* Temporarily gated for beta (see notLive above) — onConfirm
                still receives the real simulated-purchase callback from
                every caller, just not invoked from here right now.
                Re-enabling later is a one-line swap back to
                onConfirm(payToken). */}
            <button className="buy-confirm-cta" disabled={busy} onClick={() => setNotLive(true)}>
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
