"use client";

import { useRouter } from "next/navigation";
import { ALBUMS } from "@/lib/albums";
import { useAppShell } from "@/components/AppShellContext";
import { usePlayer } from "@/components/PlayerContext";
import AlbumView from "@/components/AlbumView";

export default function AlbumPageClient({ params }: { params: { slug: string } }) {
  const router = useRouter();
  const { chain, walletAddress, requestConnect } = useAppShell();
  const player = usePlayer();

  const album = ALBUMS.find((a) => a.slug === params.slug);

  if (!album || album.comingSoon) {
    return (
      <div className="album-wrap">
        <button className="album-back" onClick={() => router.push("/music")}>
          ← Music
        </button>
        <p style={{ color: "#8b978f" }}>That album isn&apos;t available yet.</p>
      </div>
    );
  }

  return (
    <AlbumView
      album={album}
      chain={chain}
      walletAddress={walletAddress}
      onRequestConnect={requestConnect}
      playingTrackId={player.playingTrack?.id ?? null}
      isPlaying={player.isPlaying}
      onTogglePlay={player.toggleTrack}
      onBack={() => router.push("/music")}
    />
  );
}
