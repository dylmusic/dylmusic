"use client";

import { useEffect, useRef, useState } from "react";
import { ChainKey, Track } from "@/lib/albums";
import { useTrackCommerce } from "@/lib/useTrackCommerce";
import ListingsModal from "./ListingsModal";
import OrderBookModal from "./OrderBookModal";
import BuyConfirmModal from "./BuyConfirmModal";
import MintSuccessModal from "./MintSuccessModal";

interface Pos {
  left: number;
  top: number;
}

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function MiniPlayer({
  track,
  chain,
  walletAddress,
  isPlaying,
  currentTime,
  duration,
  canGoPrev,
  onToggle,
  onClose,
  onRequestConnect,
  onSeek,
  onPrev,
  onNext,
}: {
  track: Track;
  chain: ChainKey;
  walletAddress: string | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  canGoPrev?: boolean;
  onToggle: () => void;
  onClose: () => void;
  onRequestConnect: () => void;
  onSeek: (time: number) => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const dragRef = useRef<{ startClientX: number; startClientY: number; startPos: Pos; moved: boolean } | null>(
    null
  );
  const rootRef = useRef<HTMLDivElement>(null);

  // The floating chat pill (GlobalChatWidget) needs to sit just above this
  // bar without overlapping it. A hardcoded lift constant has already gone
  // stale twice (desktop vs. the much shorter mobile-collapsed layout) —
  // publish the REAL measured gap from the viewport bottom to this bar's
  // own top edge as a CSS var instead, so the chat pill tracks whatever
  // this component's actual on-screen size/position is, on any breakpoint,
  // without needing a second matching constant maintained elsewhere.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    function measure() {
      const rect = el!.getBoundingClientRect();
      document.documentElement.style.setProperty("--miniplayer-lift", `${window.innerHeight - rect.top}px`);
    }
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      document.documentElement.style.removeProperty("--miniplayer-lift");
    };
  }, [pos]);

  function handleDragStart(e: React.PointerEvent) {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPos: { left: rect.left, top: rect.top },
      moved: false,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }

  function handleDragMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;
    const el = rootRef.current;
    const maxLeft = window.innerWidth - (el?.offsetWidth ?? 0) - 4;
    const maxTop = window.innerHeight - (el?.offsetHeight ?? 0) - 4;
    setPos({
      left: Math.min(Math.max(4, drag.startPos.left + dx), Math.max(4, maxLeft)),
      top: Math.min(Math.max(4, drag.startPos.top + dy), Math.max(4, maxTop)),
    });
  }

  function handleDragEnd(e: React.PointerEvent) {
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }

  const commerce = useTrackCommerce([track], chain, walletAddress);
  const { minted, ownedEditions, listings, books } = commerce;
  const trackMinted = minted[track.id] ?? 0;
  const trackOwned = ownedEditions[track.id] ?? [];
  const trackListings = listings[track.id] ?? {};
  const book = books[track.id] ?? [];
  const floor = book[0] ?? null;

  const listedPrices = Object.values(trackListings);
  const sellDisplayPrice = listedPrices.length ? Math.min(...listedPrices) : track.priceUsd;
  const busy = commerce.busyKey?.startsWith(`${track.id}:`) ?? false;

  return (
    <div
      className="mini-player"
      ref={rootRef}
      style={pos ? { left: pos.left, top: pos.top, right: "auto", bottom: "auto" } : undefined}
    >
      <div
        className="mini-player-titlebar"
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
      >
        <span className="mini-player-titlebar-label">Now Playing</span>
        <button
          className="mini-player-close"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClose}
          aria-label="Close player"
        >
          <svg width="10" height="10" viewBox="0 0 8 8">
            <path d="M1 1l6 6M7 1l-6 6" stroke="#04140a" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="mini-player-top">
        <button
          className="mini-player-skip"
          onClick={onPrev}
          disabled={!onPrev || !canGoPrev}
          aria-label="Previous track"
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="currentColor">
            <rect x="2" y="1" width="2" height="12" rx="0.6" />
            <path d="M12.5 1.5c.6-.4 1.3.1 1.3.8v9.4c0 .7-.7 1.2-1.3.8l-7-4.7c-.5-.4-.5-1.1 0-1.5l7-4.8Z" />
          </svg>
        </button>

        <button
          className="mini-player-toggle"
          onClick={onToggle}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <svg width="16" height="16" viewBox="0 0 14 14" fill="currentColor">
              <rect x="2" y="1" width="4" height="12" rx="1" />
              <rect x="8" y="1" width="4" height="12" rx="1" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 14 14" fill="currentColor">
              <path d="M2.5 1.2c0-.9 1-1.4 1.7-.9l9 5.8c.7.4.7 1.4 0 1.8l-9 5.8c-.7.5-1.7 0-1.7-.9V1.2Z" />
            </svg>
          )}
        </button>

        <button className="mini-player-skip" onClick={onNext} disabled={!onNext} aria-label="Next track">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="currentColor">
            <path d="M1.5 1.5c-.6-.4-1.3.1-1.3.8v9.4c0 .7.7 1.2 1.3.8l7-4.7c.5-.4.5-1.1 0-1.5l-7-4.8Z" />
            <rect x="10" y="1" width="2" height="12" rx="0.6" />
          </svg>
        </button>

        <div className="mini-player-info">
          <span className={`track-eq mini${isPlaying ? " playing" : ""}`}>
            <span />
            <span />
            <span />
          </span>
          <div className="mini-player-text">
            <span className="mini-player-artist">Dyl</span>
            <span className="mini-player-title">{track.title}</span>
            <span className="mini-player-sub">
              {trackOwned.length > 0 ? `You own ${trackOwned.length}` : `${trackMinted}/${track.editionCap} minted`}
            </span>
          </div>
        </div>
      </div>

      <div
        className="mini-player-seek"
        onClick={(e) => {
          if (!duration) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
          onSeek(ratio * duration);
        }}
      >
        <div className="mini-player-seek-track">
          <div
            className="mini-player-seek-fill"
            style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
          />
          <div
            className="mini-player-seek-thumb"
            style={{ left: `${duration ? (currentTime / duration) * 100 : 0}%` }}
          />
        </div>
        <div className="mini-player-seek-times">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      <div className="mini-player-actions">
        {commerce.deployed && commerce.realBooksLoading ? (
          <button className="btn-buy" disabled>
            Loading…
          </button>
        ) : !floor ? (
          <button className="btn-buy" disabled>
            Sold Out
          </button>
        ) : !walletAddress ? (
          <button className="btn-buy" onClick={onRequestConnect}>
            Connect
          </button>
        ) : (
          <div className="btn-buy-split">
            <button
              className="btn-buy"
              onClick={() => commerce.requestBuyFloor(track, onRequestConnect)}
              disabled={busy}
            >
              {busy ? "Buying…" : `Buy $${floor.priceUsd.toFixed(2)}`}
            </button>
            <button
              className="btn-buy-expand"
              onClick={() => setBookOpen(true)}
              title="View order book"
              aria-label="View order book"
            >
              <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                <path d="M1 3l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        )}

        <button
          className="btn-sell"
          onClick={() => (walletAddress ? setModalOpen(true) : onRequestConnect())}
        >
          Sell ${sellDisplayPrice.toFixed(2)}
        </button>
      </div>

      {modalOpen && (
        <ListingsModal
          track={track}
          editions={trackOwned.map((editionNumber) => ({
            editionNumber,
            listedPrice: trackListings[editionNumber] ?? null,
          }))}
          onSetPrice={(editionNumber, price) => commerce.setEditionPrice(track, editionNumber, price)}
          onCancelListing={(editionNumber) => commerce.cancelEditionListing(track, editionNumber)}
          onClose={() => setModalOpen(false)}
        />
      )}

      {bookOpen && (
        <OrderBookModal
          track={track}
          book={book}
          busyKey={commerce.busyKey?.startsWith(`${track.id}:`) ? commerce.busyKey.split(":")[1] : null}
          onBuyMint={(qty) => {
            const mintEntry = book.find((e) => e.type === "mint");
            if (mintEntry) commerce.requestBuyFromBook(track, mintEntry, onRequestConnect, qty);
          }}
          onBuyResale={(entry) => commerce.requestBuyFromBook(track, entry, onRequestConnect)}
          onClose={() => setBookOpen(false)}
        />
      )}

      {commerce.pendingBuy && (
        <BuyConfirmModal
          track={commerce.pendingBuy.track}
          entry={commerce.pendingBuy.entry}
          quantity={commerce.pendingBuy.quantity}
          defaultPayToken={commerce.defaultPayToken}
          buyStep={commerce.buyStep}
          busy={commerce.busyKey !== null}
          onConfirm={commerce.confirmPendingBuy}
          onCancel={commerce.cancelPendingBuy}
        />
      )}

      {commerce.mintSuccess && (
        <MintSuccessModal info={commerce.mintSuccess} onClose={() => commerce.setMintSuccess(null)} />
      )}
    </div>
  );
}
