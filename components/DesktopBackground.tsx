"use client";

import { ALBUMS, CHAINS, Track } from "@/lib/albums";
import { usePersistedChain } from "@/lib/useChain";
import { usePlayer } from "./PlayerContext";
import Visualizer from "./Visualizer";
import DesktopFiles from "./DesktopFiles";

const ALL_TRACKS: Track[] = ALBUMS.flatMap((a) => a.tracks);

// One persistent desktop scene behind every page — rendered once in the
// root layout, outside any route segment, so it (and whatever track is
// playing) survives client-side navigation instead of resetting per page.
// Real page content/window chrome paints on top of it in normal DOM flow;
// this only needs to stay visually behind that content, not interactive
// with it, so no avoidRef — icons are free to scatter under window chrome
// since the (opaque) windows simply cover them there.
export default function DesktopBackground() {
  const [chain] = usePersistedChain();
  const player = usePlayer();
  const activeChain = CHAINS.find((c) => c.key === chain) ?? CHAINS[0];

  return (
    <div className="desktop-bg" style={{ "--accent": activeChain.color } as React.CSSProperties}>
      <Visualizer color={activeChain.color} analyser={player.isPlaying ? player.analyser : null} />
      <DesktopFiles
        tracks={ALL_TRACKS}
        playingTrackId={player.playingTrack?.id ?? null}
        isPlaying={player.isPlaying}
        onTrackClick={(t) => player.toggleTrack(t)}
        avoidRect={{ left: 14, top: 20, right: 92, bottom: 88 }}
      />
    </div>
  );
}
