"use client";

import Image from "next/image";
import { Album, ChainKey } from "@/lib/albums";
import { getOwnedEditions } from "@/lib/holdings";

function ownedSummary(album: Album, chain: ChainKey, wallet: string | null) {
  if (!wallet) return { ownedCount: 0, fullyCollected: false };
  let ownedCount = 0;
  let tracksWithAny = 0;
  for (const t of album.tracks) {
    const owned = getOwnedEditions(chain, wallet, t.id).length;
    ownedCount += owned;
    if (owned > 0) tracksWithAny += 1;
  }
  return {
    ownedCount,
    fullyCollected: album.tracks.length > 0 && tracksWithAny === album.tracks.length,
  };
}

export default function MusicGrid({
  albums,
  chain,
  walletAddress,
  onOpenAlbum,
}: {
  albums: Album[];
  chain: ChainKey;
  walletAddress: string | null;
  onOpenAlbum: (album: Album) => void;
}) {
  return (
    <div className="music-grid-wrap">
      <div className="music-grid-head">
        <div className="dash-eyebrow">Music</div>
        <h1>Discography</h1>
      </div>

      <div className="music-grid">
        {albums.map((album) => {
          const total = album.tracks.reduce((sum, t) => sum + t.priceUsd, 0);
          const { ownedCount, fullyCollected } = ownedSummary(album, chain, walletAddress);
          return (
            <button
              key={album.slug}
              className={`music-card${album.comingSoon ? " coming-soon" : ""}`}
              onClick={() => !album.comingSoon && onOpenAlbum(album)}
              disabled={album.comingSoon}
            >
              <div className="music-card-cover">
                <Image
                  src={album.coverImage}
                  alt={album.title}
                  fill
                  sizes="(max-width: 640px) 45vw, 260px"
                  style={{ objectFit: "cover" }}
                />
                {album.comingSoon && <span className="music-card-badge">Coming Soon</span>}
                {fullyCollected && <span className="music-card-collected">★ Collected</span>}
              </div>
              <div className="music-card-title">{album.title}</div>
              <div className="music-card-sub">
                {album.comingSoon ? (
                  <span>
                    {album.year}
                    {album.tracks.length > 0 ? ` · ${album.tracks.length} tracks` : " · Coming Soon"}
                  </span>
                ) : (
                  <span>
                    {album.year} · {album.tracks.length} tracks · ${total.toFixed(2)}
                  </span>
                )}
              </div>
              {ownedCount > 0 && (
                <div className="music-card-owned">
                  You own {ownedCount} edition{ownedCount === 1 ? "" : "s"}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
