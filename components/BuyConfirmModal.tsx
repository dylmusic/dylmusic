"use client";

import { Fragment, useEffect, useState } from "react";
import { useAccount, useBalance } from "wagmi";
import type { Track } from "@/lib/albums";
import type { OrderBookEntry } from "@/lib/orderbook";
import { CURATED_TOKENS, PINNED_TOKENS, SWAP_CHAINS, SOLANA_CHAIN_ID } from "@/lib/dylTokens";
import type { DylToken } from "@/lib/dylTokens";
import type { PayStep } from "@/lib/payWithAnyToken";
import TokenPickerModal, { TokenIcon } from "./TokenPickerModal";
import { unlockSuccessSound } from "@/lib/successSound";
import { getTokenUsdPrice } from "@/lib/tokenUsdPrice";

// Pure UI heads-up, not what the real tx amount is derived from (that's
// still the contract's own live mintPriceWei / the listing's own priceWei)
// — just enough to warn a buyer before they burn a MetaMask round trip on
// a tx that's going to revert for insufficient funds. $0.50 covers this
// chain's real gas cost (~$0.01 per the live confirm screen) with room to
// spare for a slightly stale USD/ETH quote.
const GAS_RESERVE_USD = 0.5;

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

  const totalUsd = album ? album.totalUsd : entry ? entry.priceUsd * quantity : 0;

  // Real bug (2026-08-13): a purchase that silently failed because the
  // wallet just didn't have enough ETH looked identical to a broken
  // checkout from the outside — nothing told the buyer why. Solana pay
  // isn't covered (no EVM balance to read for it), only the EVM-native
  // case this bug actually hit.
  const isEvmNativePay = isNative && payToken.chainId !== SOLANA_CHAIN_ID;
  const { address: evmAddress } = useAccount();
  const { data: balanceData } = useBalance({
    address: evmAddress,
    chainId: payToken.chainId,
    query: { enabled: isEvmNativePay && !!evmAddress },
  });
  const [payTokenUsd, setPayTokenUsd] = useState<number | null>(null);
  useEffect(() => {
    if (!isEvmNativePay) {
      setPayTokenUsd(null);
      return;
    }
    let cancelled = false;
    getTokenUsdPrice(payToken).then((p) => {
      if (!cancelled) setPayTokenUsd(p);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEvmNativePay, payToken.chainId, payToken.address]);

  const requiredToken = payTokenUsd ? (totalUsd + GAS_RESERVE_USD) / payTokenUsd : null;
  const balanceToken = balanceData ? Number(balanceData.formatted) : null;
  const insufficientBalance =
    isEvmNativePay && requiredToken !== null && balanceToken !== null && balanceToken < requiredToken;

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
            {insufficientBalance && (
              <div className="buy-confirm-error">
                Not enough {payToken.symbol} — you have {balanceToken!.toFixed(4)}, need about{" "}
                {requiredToken!.toFixed(4)} (incl. gas).
              </div>
            )}

            <button
              className="buy-confirm-cta"
              disabled={busy || insufficientBalance}
              onClick={() => {
                // Must happen synchronously in this real click handler —
                // the success chime plays later, after several async
                // awaits, by which point browsers would otherwise block a
                // freshly-created AudioContext. See lib/successSound.ts.
                unlockSuccessSound();
                onConfirm(payToken);
              }}
            >
              {insufficientBalance ? "Insufficient balance" : busy ? "Confirming…" : "Confirm Buy"}
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
