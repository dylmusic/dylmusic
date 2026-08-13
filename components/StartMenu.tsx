"use client";

import { useMemo, useState } from "react";
import { ChainKey, Track } from "@/lib/albums";
import { useTrackCommerce } from "@/lib/useTrackCommerce";
import ListingsModal from "./ListingsModal";
import OrderBookModal from "./OrderBookModal";
import BuyConfirmModal from "./BuyConfirmModal";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

type PicksMode = "top" | "shuffle";

export default function StartMenu({
  allTracks,
  chain,
  walletAddress,
  onRequestConnect,
  playingTrackId,
  isPlaying,
  onTogglePlay,
  onClose,
}: {
  allTracks: Track[];
  chain: ChainKey;
  walletAddress: string | null;
  onRequestConnect: () => void;
  playingTrackId: string | null;
  isPlaying: boolean;
  onTogglePlay: (t: Track, queue?: Track[]) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<PicksMode>("top");
  const [shuffled, setShuffled] = useState<Track[]>(() => shuffle(allTracks).slice(0, 12));
  const [modalTrackId, setModalTrackId] = useState<string | null>(null);
  const [bookTrackId, setBookTrackId] = useState<string | null>(null);

  const topPicked = useMemo(
    () => [...allTracks].sort((a, b) => b.priceUsd - a.priceUsd).slice(0, 12),
    [allTracks]
  );

  const picked = mode === "top" ? topPicked : shuffled;

  function handleShuffleClick() {
    setShuffled(shuffle(allTracks).slice(0, 12));
    setMode("shuffle");
  }

  const commerce = useTrackCommerce(picked, chain, walletAddress);

  const modalTrack = modalTrackId ? picked.find((t) => t.id === modalTrackId)! : null;
  const modalEditions = modalTrack
    ? (commerce.ownedEditions[modalTrack.id] ?? []).map((editionNumber) => ({
        editionNumber,
        listedPrice: commerce.listings[modalTrack.id]?.[editionNumber] ?? null,
      }))
    : [];

  const bookTrack = bookTrackId ? picked.find((t) => t.id === bookTrackId)! : null;

  return (
    <div className="start-backdrop" onClick={onClose}>
      <div className="start-menu" onClick={(e) => e.stopPropagation()}>
        <div className="start-menu-strip">
          <span>DYL</span>
        </div>

        <div className="start-menu-body">
          <div className="start-menu-tabs">
            <button
              className={`start-menu-tab${mode === "top" ? " active" : ""}`}
              onClick={() => setMode("top")}
            >
              Top Songs
            </button>
            <button
              className={`start-menu-tab${mode === "shuffle" ? " active" : ""}`}
              onClick={handleShuffleClick}
            >
              Shuffle Songs
            </button>
          </div>
          {picked.map((t) => {
            const active = playingTrackId === t.id;
            const floor = commerce.books[t.id]?.[0];
            const listedPrices = Object.values(commerce.listings[t.id] ?? {});
            const sellPrice = listedPrices.length ? Math.min(...listedPrices) : t.priceUsd;
            const busy = commerce.busyKey?.startsWith(`${t.id}:`) ?? false;

            return (
              <div key={t.id} className={`start-menu-row${active ? " active" : ""}`}>
                <button
                  className="start-menu-play"
                  onClick={() => onTogglePlay(t, picked)}
                  aria-label={`Play ${t.title}`}
                >
                  {active ? (
                    <span className={`track-eq mini${isPlaying ? " playing" : ""}`}>
                      <span />
                      <span />
                      <span />
                    </span>
                  ) : (
                    <svg width="10" height="10" viewBox="0 0 14 14" fill="currentColor">
                      <path d="M2.5 1.2c0-.9 1-1.4 1.7-.9l9 5.8c.7.4.7 1.4 0 1.8l-9 5.8c-.7.5-1.7 0-1.7-.9V1.2Z" />
                    </svg>
                  )}
                </button>

                <div className="start-menu-title" onClick={() => onTogglePlay(t, picked)}>
                  {t.title}
                </div>

                <div className="start-menu-actions">
                  {commerce.deployed && commerce.realBooksLoading ? (
                    <button className="btn-buy" disabled>
                      Loading…
                    </button>
                  ) : !floor ? (
                    <button className="btn-buy" disabled>
                      Sold Out
                    </button>
                  ) : (
                    <div className="btn-buy-split">
                      <button
                        className="btn-buy"
                        disabled={busy}
                        onClick={() => commerce.requestBuyFloor(t, onRequestConnect)}
                      >
                        {busy ? "…" : `Buy $${floor.priceUsd.toFixed(2)}`}
                      </button>
                      <button
                        className="btn-buy-expand"
                        onClick={() => setBookTrackId(t.id)}
                        title="View order book"
                        aria-label="View order book"
                      >
                        <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                          <path
                            d="M1 3l4 4 4-4"
                            stroke="currentColor"
                            strokeWidth="1.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </div>
                  )}
                  <button
                    className="btn-sell"
                    onClick={() =>
                      walletAddress ? setModalTrackId(t.id) : onRequestConnect()
                    }
                  >
                    Sell ${sellPrice.toFixed(2)}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {modalTrack && (
        <ListingsModal
          track={modalTrack}
          editions={modalEditions}
          onSetPrice={(editionNumber, price) => commerce.setEditionPrice(modalTrack, editionNumber, price)}
          onCancelListing={(editionNumber) => commerce.cancelEditionListing(modalTrack, editionNumber)}
          onClose={() => setModalTrackId(null)}
        />
      )}

      {bookTrack && (
        <OrderBookModal
          track={bookTrack}
          book={commerce.books[bookTrack.id] ?? []}
          busyKey={
            commerce.busyKey?.startsWith(`${bookTrack.id}:`)
              ? commerce.busyKey.split(":")[1]
              : null
          }
          onBuyMint={(qty) => {
            const mintEntry = commerce.books[bookTrack.id]?.find((e) => e.type === "mint");
            if (mintEntry) commerce.requestBuyFromBook(bookTrack, mintEntry, onRequestConnect, qty);
          }}
          onBuyResale={(entry) => commerce.requestBuyFromBook(bookTrack, entry, onRequestConnect)}
          onClose={() => setBookTrackId(null)}
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
    </div>
  );
}
