"use client";

import { useEffect, useState } from "react";
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

  // .desktop-bg is position:fixed (one viewport), but mobile pages stack
  // into a single tall column many viewports long that scrolls underneath
  // it — the icon layer has no way to know what page content is currently
  // scrolled under a given fixed screen position, so on a phone the
  // scattered icons constantly collide with real text no matter where you
  // scroll to. There's no static "avoid" box that can fix that (it would
  // need to cover nearly the entire fixed viewport, leaving nowhere for
  // icons anyway) — cleanest fix is to just not scatter icons on mobile.
  // The Windows-95 feel still comes through plenty via the taskbar, window
  // chrome, and Start menu; this background keeps the moody particle
  // visualizer either way.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    setIsMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // The avoid box used to be one flat guess (14-92% x 20-88%) regardless of
  // real viewport size — on any screen wider than .landing-inner's own
  // 1080px max-width (i.e. most desktop monitors), that reserved a much
  // bigger dead zone than the hero content actually occupies, which is
  // exactly what Dylan flagged: "a lot of the homepage is still not
  // interactive... trying to interact with the background on areas where
  // there's no text or anything but it doesn't work." Real fix: derive the
  // horizontal margin from the actual CSS constants (.landing-inner
  // max-width 1080px, .landing's 24px side padding) against the real
  // window width, so wide screens correctly free up most of their sides
  // for icons instead of avoiding a fixed percentage that no longer
  // matches anything real. Vertical stays a flatter, slightly tighter
  // guess (content height doesn't scale with width the same way) but is
  // still tighter than before (was 20/88, now 16/88 — the real hero
  // content starts closer to ~11% down, not 20%).
  const FALLBACK_AVOID = { left: 14, top: 20, right: 92, bottom: 88 };
  const [avoidRect, setAvoidRect] = useState(FALLBACK_AVOID);
  useEffect(() => {
    function recompute() {
      const vw = window.innerWidth;
      const contentWidth = Math.min(1080, Math.max(0, vw - 48));
      const sidePct = ((vw - contentWidth) / 2 / vw) * 100;
      setAvoidRect({
        left: Math.max(2, sidePct),
        right: Math.min(98, 100 - sidePct),
        top: 16,
        bottom: 88,
      });
    }
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, []);

  return (
    <div className="desktop-bg" style={{ "--accent": activeChain.color } as React.CSSProperties}>
      <Visualizer color={activeChain.color} analyser={player.isPlaying ? player.analyser : null} />
      {!isMobile && (
        <DesktopFiles
          tracks={ALL_TRACKS}
          playingTrackId={player.playingTrack?.id ?? null}
          isPlaying={player.isPlaying}
          onTrackClick={(t) => player.toggleTrack(t)}
          avoidRect={avoidRect}
        />
      )}
    </div>
  );
}
