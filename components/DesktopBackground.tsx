"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ALBUMS, CHAINS, Track } from "@/lib/albums";
import { usePersistedChain } from "@/lib/useChain";
import { usePlayer } from "./PlayerContext";
import Visualizer from "./Visualizer";
import DesktopFiles, { MobileDesktopFiles } from "./DesktopFiles";

const ALL_TRACKS: Track[] = ALBUMS.flatMap((a) => a.tracks);

// Real gaps big enough for an icon are naturally scarce on mobile (see
// MobileDesktopFiles) — this is just a ceiling in case a very long page
// happens to have more than a handful, so it doesn't start looking cluttered.
const MAX_MOBILE_ICONS = 6;

function shuffledTracks(): Track[] {
  const arr = [...ALL_TRACKS];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

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
  const pathname = usePathname();
  const activeChain = CHAINS.find((c) => c.key === chain) ?? CHAINS[0];

  // .desktop-bg is position:fixed (one viewport), but mobile pages stack
  // into a single tall column many viewports long that scrolls underneath
  // it — the fixed-grid icon layer has no way to know what page content is
  // currently scrolled under a given fixed screen position, so scattering
  // icons the same way desktop does put them directly on top of hero text.
  // Desktop gets away with the fixed-viewport approach because a wide
  // screen keeps real, unbroken side margins around the centered content
  // column at every scroll depth — mobile has no equivalent side gutter at
  // all, the content runs edge to edge. Real fix (MobileDesktopFiles,
  // below): render a handful of icons directly in the document's own flow,
  // at real measured gaps between real content blocks, so they scroll away
  // with the page instead of hovering fixed over whatever's underneath.
  const [isMobile, setIsMobile] = useState(false);
  const [mobileTrackPool] = useState(shuffledTracks);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    setIsMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // The avoid box used to be a flat guess for ALL FOUR edges (originally
  // 14-92% x 20-88%, later just left/right derived from real CSS constants
  // while top/bottom stayed flat 16/88 guesses). The flat top/bottom guess
  // is what broke: it assumes real content top position scales with
  // viewport HEIGHT (a percentage), but it's actually driven by a roughly
  // fixed-px header height — confirmed live at 1280x800, where real
  // .landing-content started at 9.75% down but the flat guess assumed 16%,
  // leaving a real band of hero text between those two numbers that the
  // avoid box thought was empty. Real fix, same philosophy as
  // MobileDesktopFiles: measure the actual on-screen content box (whichever
  // of .landing-inner / .win95-window the current page has) instead of
  // deriving it from CSS constants, and recompute on navigation too since
  // different routes have completely different content shapes.
  const FALLBACK_AVOID = { left: 14, top: 9, right: 86, bottom: 90 };
  const [avoidRect, setAvoidRect] = useState(FALLBACK_AVOID);
  // The central avoid box above only excludes a rectangle in the middle of
  // the screen — it does nothing to stop an icon landing past its bottom
  // edge, in the same x range, directly on top of the fixed site-taskbar
  // (confirmed live: with only the central box, ~10% of icons landed
  // squarely on the taskbar and were genuinely unclickable — the taskbar's
  // own z-index:50 correctly wins the hit-test, so the icon underneath is
  // just dead). This is a real, full-width band, independent of x, sized
  // from the taskbar's actual CSS height (40px) plus half an icon's real
  // footprint so a centered icon can't still clip into it.
  const [chromeBottomPct, setChromeBottomPct] = useState(10);
  useEffect(() => {
    function recompute() {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const PAD = 1.5; // percent buffer around the real measured box
      const contentEl =
        document.querySelector<HTMLElement>(".landing-inner") ??
        document.querySelector<HTMLElement>(".win95-window");
      if (contentEl) {
        const r = contentEl.getBoundingClientRect();
        setAvoidRect({
          left: Math.max(0, (r.left / vw) * 100 - PAD),
          right: Math.min(100, (r.right / vw) * 100 + PAD),
          top: Math.max(0, (r.top / vh) * 100 - PAD),
          bottom: Math.min(100, (r.bottom / vh) * 100 + PAD),
        });
      } else {
        setAvoidRect(FALLBACK_AVOID);
      }
      const TASKBAR_PX = 40;
      const ICON_SAFE_PX = 46; // ~half the real icon+label footprint
      setChromeBottomPct(Math.min(30, ((TASKBAR_PX + ICON_SAFE_PX) / vh) * 100));
    }
    recompute();
    // Content can still be settling right after navigation (images,
    // fonts) — a couple retries catch that without a full MutationObserver.
    const t1 = setTimeout(recompute, 300);
    const t2 = setTimeout(recompute, 1000);
    window.addEventListener("resize", recompute);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener("resize", recompute);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <>
      <div className="desktop-bg" style={{ "--accent": activeChain.color } as React.CSSProperties}>
        <Visualizer color={activeChain.color} analyser={player.isPlaying ? player.analyser : null} />
        {!isMobile && (
          <DesktopFiles
            tracks={ALL_TRACKS}
            playingTrackId={player.playingTrack?.id ?? null}
            isPlaying={player.isPlaying}
            onTrackClick={(t) => player.toggleTrack(t)}
            avoidRect={avoidRect}
            chromeBottomPct={chromeBottomPct}
          />
        )}
      </div>
      {/* Rendered as a sibling of .desktop-bg, deliberately NOT nested
          inside it — .desktop-bg is position:fixed, which would make any
          descendant position:absolute icon resolve against the fixed
          viewport too. Living outside it, with no positioned ancestor,
          these icons resolve against the document instead and scroll
          normally with the page. */}
      {isMobile && (
        <MobileDesktopFiles
          tracks={mobileTrackPool.slice(0, MAX_MOBILE_ICONS)}
          playingTrackId={player.playingTrack?.id ?? null}
          isPlaying={player.isPlaying}
          onTrackClick={(t) => player.toggleTrack(t)}
          routeKey={pathname}
        />
      )}
    </>
  );
}
