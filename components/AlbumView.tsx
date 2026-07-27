"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { Album, ChainKey, Track, baselineMinted } from "@/lib/albums";
import {
  getOwnedEditions,
  getListings,
  localMintedCount,
  recordMint,
  setListingForEdition,
  buyListedEdition,
} from "@/lib/holdings";
import { buildOrderBook, OrderBookEntry } from "@/lib/orderbook";
import { recordActivity } from "@/lib/activity";
import TrackRow from "./TrackRow";
import ListingsModal from "./ListingsModal";
import OrderBookModal from "./OrderBookModal";

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
  onTogglePlay: (track: Track) => void;
  onBack?: () => void;
}) {
  const [tick, setTick] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modalTrackId, setModalTrackId] = useState<string | null>(null);
  const [bookTrackId, setBookTrackId] = useState<string | null>(null);

  const minted = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of album.tracks) {
      m[t.id] = baselineMinted(t, chain) + localMintedCount(chain, t.id);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [album, chain, tick]);

  const ownedEditions = useMemo(() => {
    if (!walletAddress) return {};
    const h: Record<string, number[]> = {};
    for (const t of album.tracks) {
      h[t.id] = getOwnedEditions(chain, walletAddress, t.id);
    }
    return h;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [album, chain, walletAddress, tick]);

  const listings = useMemo(() => {
    if (!walletAddress) return {};
    const l: Record<string, Record<number, number>> = {};
    for (const t of album.tracks) {
      l[t.id] = getListings(chain, walletAddress, t.id);
    }
    return l;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [album, chain, walletAddress, tick]);

  const books = useMemo(() => {
    const b: Record<string, OrderBookEntry[]> = {};
    for (const t of album.tracks) {
      b[t.id] = buildOrderBook(t, chain);
    }
    return b;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [album, chain, tick]);

  const sweepTracks = album.tracks.filter(
    (t) => (ownedEditions[t.id]?.length ?? 0) === 0 && minted[t.id] < t.editionCap
  );
  const sweepTotal = sweepTracks.reduce((sum, t) => sum + t.priceUsd, 0);

  const totalMinted = album.tracks.reduce((sum, t) => sum + minted[t.id], 0);
  const totalCap = album.tracks.reduce((sum, t) => sum + t.editionCap, 0);
  const soldPct = Math.round((totalMinted / totalCap) * 100);

  async function mintTrack(trackId: string) {
    if (!walletAddress) return;
    const t = album.tracks.find((x) => x.id === trackId)!;
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

  async function buyResale(trackId: string, entry: OrderBookEntry) {
    if (!walletAddress || entry.type !== "resale") return;
    const t = album.tracks.find((x) => x.id === trackId)!;
    buyListedEdition(chain, trackId, entry.seller!, walletAddress, entry.editionNumber!);
    recordActivity({
      type: "buy",
      chain,
      wallet: walletAddress,
      trackTitle: t.title,
      editionNumber: entry.editionNumber!,
      priceUsd: entry.priceUsd,
    });
  }

  async function buyFloor(trackId: string) {
    if (!walletAddress || busyId) return;
    const book = books[trackId];
    const floor = book?.[0];
    if (!floor) return;
    setBusyId(trackId);
    await delay(450);
    if (floor.type === "mint") await mintTrack(trackId);
    else await buyResale(trackId, floor);
    setBusyId(null);
    setTick((n) => n + 1);
  }

  async function buyFromBook(trackId: string, entry: OrderBookEntry) {
    if (!walletAddress) {
      onRequestConnect();
      return;
    }
    if (busyId) return;
    setBusyId(`${trackId}:${entry.type === "mint" ? "mint" : entry.editionNumber}`);
    await delay(450);
    if (entry.type === "mint") await mintTrack(trackId);
    else await buyResale(trackId, entry);
    setBusyId(null);
    setTick((n) => n + 1);
  }

  async function buyAlbum() {
    if (!walletAddress) {
      onRequestConnect();
      return;
    }
    if (busyId || sweepTracks.length === 0) return;
    setBusyId("__album__");
    for (const t of sweepTracks) {
      await delay(180);
      await mintTrack(t.id);
    }
    setBusyId(null);
    setTick((n) => n + 1);
  }

  function setEditionPrice(trackId: string, editionNumber: number, price: number) {
    if (!walletAddress) return;
    const t = album.tracks.find((x) => x.id === trackId)!;
    setListingForEdition(chain, walletAddress, trackId, editionNumber, price);
    recordActivity({
      type: "sell",
      chain,
      wallet: walletAddress,
      trackTitle: t.title,
      editionNumber,
      priceUsd: price,
    });
    setTick((n) => n + 1);
  }

  function cancelEditionListing(trackId: string, editionNumber: number) {
    if (!walletAddress) return;
    setListingForEdition(chain, walletAddress, trackId, editionNumber, null);
    setTick((n) => n + 1);
  }

  const totalEditionsOwned = album.tracks.reduce(
    (sum, t) => sum + (ownedEditions[t.id]?.length ?? 0),
    0
  );

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
          <h1>{album.title}</h1>
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
            disabled={busyId !== null || sweepTracks.length === 0}
          >
            {busyId === "__album__"
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
            busy={busyId === t.id}
            isPlaying={playingTrackId === t.id && isPlaying}
            isActive={playingTrackId === t.id}
            onTogglePlay={() => onTogglePlay(t)}
            onBuyFloor={() => buyFloor(t.id)}
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
          onSetPrice={(editionNumber, price) => setEditionPrice(modalTrack.id, editionNumber, price)}
          onCancelListing={(editionNumber) => cancelEditionListing(modalTrack.id, editionNumber)}
          onClose={() => setModalTrackId(null)}
        />
      )}

      {bookTrack && (
        <OrderBookModal
          track={bookTrack}
          book={books[bookTrack.id] ?? []}
          busyKey={
            busyId?.startsWith(`${bookTrack.id}:`) ? busyId.split(":")[1] : null
          }
          onBuyMint={() => {
            const mintEntry = books[bookTrack.id]?.find((e) => e.type === "mint");
            if (mintEntry) buyFromBook(bookTrack.id, mintEntry);
          }}
          onBuyResale={(entry) => buyFromBook(bookTrack.id, entry)}
          onClose={() => setBookTrackId(null)}
        />
      )}
    </div>
  );
}
