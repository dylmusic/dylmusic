"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Album, ChainKey } from "@/lib/albums";
import { CONTRACT_TARGETS } from "@/lib/admin";
import { fetchRealOwnedTokenIds } from "@/lib/realOrderBook";
import { decodeTokenId } from "@/lib/tokenIdScheme";

function isRealDeployed(chain: ChainKey): boolean {
  return !!CONTRACT_TARGETS.find((t) => t.key === chain)?.address;
}

// Real per-track owned-edition counts for the WHOLE wallet on this chain,
// one fetch, not per-album/per-track. Was previously calling `holdings.ts`'s
// simulated `getOwnedEditions` unconditionally, with no real/simulated
// switch at all — the one place in the whole ownership pipeline that never
// got wired to real on-chain data when lib/useTrackCommerce.ts's `books`/
// `minted`/`ownedEditions` did (see the matching `listings` fix in that
// file). Real result: caught live showing "You own 57 editions" — pure
// leftover localStorage demo data from pre-launch testing, not real
// holdings (the wallet's REAL count, verified on-chain, is 10 per track).
// A chain with no deployed contract (everything but Robinhood, today) has
// no real activity at all — real zero, not simulated data (Dylan, live:
// "remove simulated data for Base, SOL, ETH, move it to the real info
// which is zero").
function useRealOwnedCounts(chain: ChainKey, wallet: string | null): Record<number, number> {
  const [counts, setCounts] = useState<Record<number, number>>({});
  useEffect(() => {
    if (!isRealDeployed(chain) || chain === "solana" || !wallet) {
      setCounts({});
      return;
    }
    let cancelled = false;
    (async () => {
      const tokenIds = await fetchRealOwnedTokenIds(chain, wallet);
      if (cancelled) return;
      const byTrack: Record<number, number> = {};
      for (const tokenId of tokenIds) {
        const { trackId } = decodeTokenId(tokenId);
        byTrack[trackId] = (byTrack[trackId] ?? 0) + 1;
      }
      setCounts(byTrack);
    })();
    return () => {
      cancelled = true;
    };
  }, [chain, wallet]);
  return counts;
}

function ownedSummary(album: Album, wallet: string | null, realCounts: Record<number, number>) {
  if (!wallet) return { ownedCount: 0, fullyCollected: false };
  let ownedCount = 0;
  let tracksWithAny = 0;
  for (const t of album.tracks) {
    const owned = realCounts[t.index] ?? 0;
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
  const realCounts = useRealOwnedCounts(chain, walletAddress);
  return (
    <div className="music-grid-wrap">
      <div className="music-grid-head">
        <div className="dash-eyebrow">Music</div>
        <h1>Discography</h1>
      </div>

      <div className="music-grid">
        {albums.map((album) => {
          const total = album.tracks.reduce((sum, t) => sum + t.priceUsd, 0);
          const { ownedCount, fullyCollected } = ownedSummary(album, walletAddress, realCounts);
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
