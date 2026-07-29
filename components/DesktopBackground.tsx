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
// with it.
//
// Icon placement is deliberately simple (see DesktopFiles.tsx) — the same
// scattered-randomly, fixed-to-the-viewport icons on both desktop and
// mobile, no per-page content measurement, no separate mobile gap-detection
// system. A more "content-aware" version was tried across several rounds
// (measuring real content boxes, excluding fixed chrome, a document-flow
// mobile variant that found real empty gaps between page sections) but each
// fix surfaced a new bug — icons clustering on one side, a scroll-blocking
// CSS regression, and a position-recompute effect that reshuffled every
// icon from scratch several times per page load, which read as icons
// randomly appearing and disappearing. Dylan's call: go back to the plain
// version — some icons land under hero text and aren't clickable there,
// most aren't, and that's preferred over the smart version's instability.
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
      />
    </div>
  );
}
