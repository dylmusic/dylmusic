"use client";

import Image from "next/image";
import { useState } from "react";
import { Album, ChainKey, Track, baselineMinted } from "@/lib/albums";
import { localMintedCount, recordMint } from "@/lib/holdings";
import { recordActivity } from "@/lib/activity";
import { useStreamCountsLoaded } from "@/lib/streams";
import { useTrackCommerce } from "@/lib/useTrackCommerce";
import TrackRow from "./TrackRow";
import ListingsModal from "./ListingsModal";
import OrderBookModal from "./OrderBookModal";
import BuyConfirmModal from "./BuyConfirmModal";

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

export default function AlbumView({
  album,
  chain,
  walletAddress,
  onRequestConnect,
  playingTrackId,
  isPlaying,
  onTogglePlay,
  onBack,
}: {
  album: Album;
  chain: ChainKey;
  walletAddress: string | null;
  onRequestConnect: () => void;
  playingTrackId: string | null;
  isPlaying: boolean;
  onTogglePlay: (track: Track, queue?: Track[]) => void;
  onBack?: () => void;
}) {
  const [sweepBusy, setSweepBusy] = useState(false);
  const [modalTrackId, setModalTrackId] = useState<string | null>(null);
  const [bookTrackId, setBookTrackId] = useState<string | null>(null);

  useStreamCountsLoaded();
  const commerce = useTrackCommerce(album.tracks, chain, walletAddress);
  const { minted, ownedEditions, listings, books } = commerce;

  const sweepTracks = album.tracks.filter(
    (t) => (ownedEditions[t.id]?.length ?? 0) === 0 && minted[t.id] < t.editionCap
  );
  const sweepTotal = sweepTracks.reduce((sum, t) => sum + t.priceUsd, 0);

  const totalMinted = album.tracks.reduce((sum, t) => sum + minted[t.id], 0);
  const totalCap = album.tracks.reduce((sum, t) => sum + t.editionCap, 0);
  const soldPct = Math.round((totalMinted / totalCap) * 100);

  // Bulk "buy the whole album" stays a single simulated action at native
  // price, same as before — a Pay-With popup per track would make sweeping
  // 19 tracks tedious, so this one path skips it on purpose.
  async function buyAlbum() {
    if (!walletAddress) {
      onRequestConnect();
      return;
    }
    if (sweepBusy || sweepTracks.length === 0) return;
    setSweepBusy(true);
    for (const t of sweepTracks) {
      await delay(180);
      const current = baselineMinted(t, chain) + localMintedCount(chain, t.id);
      if (current < t.editionCap) {
        recordMint(chain, walletAddress, t.id, current + 1);
        recordActivity({
          type: "buy",
          chain,
          wallet: walletAddress,
          trackTitle: t.title,
          editionNumber: current + 1,
          priceUsd: t.priceUsd,
        });
      }
    }
    setSweepBusy(false);
    commerce.refresh();
  }

  const totalEditionsOwned = album.tracks.reduce(
    (sum, t) => sum + (ownedEditions[t.id]?.length ?? 0),
    0
  );
  const fullyCollected =
    album.tracks.length > 0 && album.tracks.every((t) => (ownedEditions[t.id]?.length ?? 0) > 0);

  const modalTrack = modalTrackId ? album.tracks.find((t) => t.id === modalTrackId)! : null;
  const modalEditions = modalTrack
    ? (ownedEditions[modalTrack.id] ?? []).map((editionNumber) => ({
        editionNumber,
        listedPrice: listings[modalTrack.id]?.[editionNumber] ?? null,
      }))
    : [];

  const bookTrack = bookTrackId ? album.tracks.find((t) => t.id === bookTrackId)! : null;

  return (
    <div className="album-wrap">
      {onBack && (
        <button className="album-back" onClick={onBack}>
          ← Music
        </button>
      )}

      <div className="album-header">
        <div className="album-cover">
          <Image
            src={album.coverImage}
            alt={album.title}
            fill
            sizes="(max-width: 640px) 220px, 220px"
            priority
            style={{ objectFit: "cover" }}
          />
        </div>

        <div className="album-meta">
          <div className="album-eyebrow">Album · {album.year}</div>
          <h1>
            {album.title}
            {fullyCollected && <span className="music-card-collected album-collected">★ Collected</span>}
          </h1>
          <div className="album-artist-row">
            <div className="album-artist">{album.artist}</div>
            <a
              className="spotify-link"
              href="https://dylmusic.com/crypto-rich-deluxe"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="spotify-dot" />
              Listen on Spotify
            </a>
          </div>

          <div className="album-stats">
            <div>
              <span className="stat-num">{album.tracks.length}</span>
              <span className="stat-label">tracks</span>
            </div>
            <div>
              <span className="stat-num">{totalEditionsOwned}</span>
              <span className="stat-label">editions you own</span>
            </div>
            <div>
              <span className="stat-num">{soldPct}%</span>
              <span className="stat-label">sold ({chain})</span>
            </div>
          </div>

          <button
            className="btn-sweep"
            onClick={buyAlbum}
            disabled={sweepBusy || sweepTracks.length === 0}
          >
            {sweepBusy
              ? "Buying album…"
              : sweepTracks.length === 0
              ? "Album complete"
              : `Buy Album · $${sweepTotal.toFixed(2)}`}
          </button>
        </div>
      </div>

      <div className="track-list">
        {album.tracks.map((t) => (
          <TrackRow
            key={t.id}
            track={t}
            minted={minted[t.id]}
            ownedEditions={ownedEditions[t.id] ?? []}
            listings={listings[t.id] ?? {}}
            book={books[t.id] ?? []}
            walletConnected={!!walletAddress}
            busy={commerce.busyKey?.startsWith(`${t.id}:`) ?? false}
            isPlaying={playingTrackId === t.id && isPlaying}
            isActive={playingTrackId === t.id}
            onTogglePlay={() => onTogglePlay(t, album.tracks)}
            onBuyFloor={() => commerce.requestBuyFloor(t, onRequestConnect)}
            onOpenOrderBook={() => setBookTrackId(t.id)}
            onConnect={onRequestConnect}
            onOpenSellModal={() => setModalTrackId(t.id)}
          />
        ))}
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
          book={books[bookTrack.id] ?? []}
          busyKey={
            commerce.busyKey?.startsWith(`${bookTrack.id}:`) ? commerce.busyKey.split(":")[1] : null
          }
          onBuyMint={(qty) => {
            const mintEntry = books[bookTrack.id]?.find((e) => e.type === "mint");
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
