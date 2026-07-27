"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { Album, ChainKey, Track, baselineMinted } from "@/lib/albums";
import {
  getHolding,
  getListingPrice,
  localMintedCount,
  recordMint,
  setListingPrice,
} from "@/lib/holdings";
import { recordActivity } from "@/lib/activity";
import TrackRow from "./TrackRow";

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

export default function AlbumView({
  album,
  chain,
  walletAddress,
  onRequestConnect,
  playingTrackId,
  isPlaying,
  onTogglePlay,
}: {
  album: Album;
  chain: ChainKey;
  walletAddress: string | null;
  onRequestConnect: () => void;
  playingTrackId: string | null;
  isPlaying: boolean;
  onTogglePlay: (track: Track) => void;
}) {
  const [tick, setTick] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);

  const minted = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of album.tracks) {
      m[t.id] = baselineMinted(t, chain) + localMintedCount(chain, t.id);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [album, chain, tick]);

  const holdings = useMemo(() => {
    if (!walletAddress) return {};
    const h: Record<string, ReturnType<typeof getHolding>> = {};
    for (const t of album.tracks) {
      h[t.id] = getHolding(chain, walletAddress, t.id);
    }
    return h;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [album, chain, walletAddress, tick]);

  const listings = useMemo(() => {
    if (!walletAddress) return {};
    const l: Record<string, number | undefined> = {};
    for (const t of album.tracks) {
      l[t.id] = getListingPrice(chain, walletAddress, t.id);
    }
    return l;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [album, chain, walletAddress, tick]);

  const sweepTracks = album.tracks.filter(
    (t) => !holdings[t.id] && minted[t.id] < t.editionCap
  );
  const sweepTotal = sweepTracks.reduce((sum, t) => sum + t.priceUsd, 0);

  const totalMinted = album.tracks.reduce((sum, t) => sum + minted[t.id], 0);
  const totalCap = album.tracks.reduce((sum, t) => sum + t.editionCap, 0);
  const soldPct = Math.round((totalMinted / totalCap) * 100);

  async function buyTrack(trackId: string) {
    if (!walletAddress || busyId) return;
    const t = album.tracks.find((x) => x.id === trackId)!;
    setBusyId(trackId);
    await delay(450);
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
    setBusyId(null);
    setTick((n) => n + 1);
  }

  function list(trackId: string, price: number) {
    if (!walletAddress) return;
    const t = album.tracks.find((x) => x.id === trackId)!;
    setListingPrice(chain, walletAddress, trackId, price);
    recordActivity({
      type: "sell",
      chain,
      wallet: walletAddress,
      trackTitle: t.title,
      editionNumber: holdings[trackId]?.editionNumber ?? null,
      priceUsd: price,
    });
    setTick((n) => n + 1);
  }

  function cancelListing(trackId: string) {
    if (!walletAddress) return;
    setListingPrice(chain, walletAddress, trackId, null);
    setTick((n) => n + 1);
  }

  const ownedCount = album.tracks.filter((t) => holdings[t.id]).length;

  return (
    <div className="album-wrap">
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
              <span className="stat-num">{ownedCount}</span>
              <span className="stat-label">you own</span>
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
            holding={holdings[t.id] ?? undefined}
            listedPrice={listings[t.id]}
            walletConnected={!!walletAddress}
            busy={busyId === t.id}
            isPlaying={playingTrackId === t.id && isPlaying}
            isActive={playingTrackId === t.id}
            onTogglePlay={() => onTogglePlay(t)}
            onBuy={() => buyTrack(t.id)}
            onConnect={onRequestConnect}
            onList={(price) => list(t.id, price)}
            onCancelListing={() => cancelListing(t.id)}
          />
        ))}
      </div>
    </div>
  );
}
