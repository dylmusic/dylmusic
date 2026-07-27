"use client";

import Image from "next/image";
import { Album } from "@/lib/albums";

export default function MusicGrid({
  albums,
  onOpenAlbum,
}: {
  albums: Album[];
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
              </div>
              <div className="music-card-title">{album.title}</div>
              <div className="music-card-sub">
                {album.comingSoon ? (
                  <span>{album.tracks.length > 0 ? `${album.tracks.length} tracks` : "Coming Soon"}</span>
                ) : (
                  <span>
                    {album.tracks.length} tracks · ${total.toFixed(2)}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
