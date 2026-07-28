"use client";

import { useEffect, useRef, useState } from "react";
import { Track } from "@/lib/albums";

interface Pos {
  x: number; // percent of container width
  y: number; // percent of container height
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const GRID_COLS = 9;
const GRID_ROWS = 8;
const AVOID_PADDING = 5; // percent, extra buffer around the real content box
// Real rendered size of a .desktop-file (84px wide, measured ~76px tall
// including both text labels) — see the padding math below for why this
// matters beyond just cosmetics.
const ICON_WIDTH_PX = 84;
const ICON_HEIGHT_PX = 76;

function rectsOverlap(cellX: number, cellY: number, r: Rect): boolean {
  return cellX >= r.left && cellX <= r.right && cellY >= r.top && cellY <= r.bottom;
}

// Grid the whole screen into cells, drop any that land on/near the real
// content box or fixed chrome (measured live, not guessed), then randomly
// assign whatever's left to tracks — genuinely different on every load, but
// never renders an icon on top of text that needs to stay readable, or a
// fixed element (taskbar, header) that would win every click over it anyway.
function randomPositions(
  tracks: Track[],
  avoidRects: Rect[],
  containerWidthPx: number,
  containerHeightPx: number
): Record<string, Pos> {
  const cellW = 100 / GRID_COLS;
  const cellH = 100 / GRID_ROWS;
  // Jitter can move a cell up to ~20% of a cell's size off its grid center.
  const jitterPadX = cellW * 0.2;
  const jitterPadY = cellH * 0.2;
  // `x`/`y` (and the CSS `left`/`top` they become) are the icon's TOP-LEFT
  // corner, not its center — a real 84x76px box, not a point. Padding the
  // avoid rect by jitter alone tested only the corner's position, letting
  // the box's own width/height extend right past it into real content
  // (confirmed live: icons landed with their CORNER just outside the
  // measured content box, but their visible body still overlapping it).
  // Padding the left/top edges by the icon's full size accounts for the
  // box extending rightward/downward from that corner; right/bottom only
  // need the jitter pad since a box anchored past the right/bottom edge
  // only extends further away, never back in.
  const iconWPct = containerWidthPx > 0 ? (ICON_WIDTH_PX / containerWidthPx) * 100 : 0;
  const iconHPct = containerHeightPx > 0 ? (ICON_HEIGHT_PX / containerHeightPx) * 100 : 0;
  const paddedAvoid = avoidRects.map((r) => ({
    left: r.left - jitterPadX - iconWPct,
    right: r.right + jitterPadX,
    top: r.top - jitterPadY - iconHPct,
    bottom: r.bottom + jitterPadY,
  }));

  const cells: { x: number; y: number }[] = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const x = ((col + 0.5) / GRID_COLS) * 100;
      const y = ((row + 0.5) / GRID_ROWS) * 100;
      if (paddedAvoid.some((r) => rectsOverlap(x, y, r))) continue;
      cells.push({ x, y });
    }
  }

  // Fisher-Yates shuffle for genuine randomness on each load.
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }

  const positions: Record<string, Pos> = {};
  // One cell per track, never reused — `pool[i % pool.length]` used to wrap
  // back to an already-assigned cell whenever there were more tracks than
  // free cells (confirmed live: with 19 tracks and an avoid box that some
  // viewports trimmed down to 18 free cells, track #19 always landed
  // exactly back on track #1's cell, and the jitter wasn't reliably enough
  // to separate two 84px icons sharing one ~140x110px cell — one covered
  // the other, making it unclickable). If there are genuinely more tracks
  // than safe cells, later tracks just don't get an icon this load rather
  // than guaranteeing an overlap — the render side skips anything with no
  // assigned position.
  const count = Math.min(tracks.length, cells.length);
  for (let i = 0; i < count; i++) {
    const cell = cells[i];
    const jitterX = (Math.random() - 0.5) * cellW * 0.4;
    const jitterY = (Math.random() - 0.5) * cellH * 0.4;
    positions[tracks[i].id] = {
      x: Math.min(97, Math.max(1, cell.x + jitterX)),
      y: Math.min(97, Math.max(2, cell.y + jitterY)),
    };
  }

  return positions;
}

// A blocky, pixel-art eighth note — stem + flag + oval notehead, hand-placed
// 1px squares on a 12x12 grid, crisp edges for that Windows-95-icon feel.
const NOTE_PIXELS: [number, number][] = [
  // stem
  [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 6], [8, 7],
  // flag
  [9, 1], [9, 2], [10, 2], [9, 3], [10, 3], [11, 3], [9, 4], [10, 4],
  // notehead (filled oval)
  [6, 7], [7, 7],
  [5, 8], [6, 8], [7, 8],
  [4, 9], [5, 9], [6, 9], [7, 9],
  [4, 10], [5, 10], [6, 10], [7, 10],
  [5, 11], [6, 11],
];

export function MusicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 12 12" shapeRendering="crispEdges">
      {NOTE_PIXELS.map(([x, y], i) => (
        <rect key={i} x={x} y={y} width="1" height="1" fill="currentColor" />
      ))}
    </svg>
  );
}

export default function DesktopFiles({
  tracks,
  playingTrackId,
  isPlaying,
  onTrackClick,
  avoidRef,
  avoidRect,
  chromeTopPct = 0,
  chromeBottomPct = 0,
}: {
  tracks: Track[];
  playingTrackId: string | null;
  isPlaying: boolean;
  onTrackClick: (track: Track) => void;
  avoidRef?: React.RefObject<HTMLElement>;
  avoidRect?: Rect;
  // Full-width bands (percent of container height) to always exclude,
  // regardless of x — the content avoid box below only cuts out a central
  // rectangle, which does NOT stop icons from landing past it at the far
  // left/right OR directly above/below it in the same x range. Fixed chrome
  // (the taskbar, the header) spans the FULL width, so it needs its own
  // full-width exclusion or icons can still land on top of it and become
  // genuinely unclickable (confirmed live: ~10% of icons did before this).
  chromeTopPct?: number;
  chromeBottomPct?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<Record<string, Pos>>({});
  const dragRef = useRef<{
    id: string;
    startClientX: number;
    startClientY: number;
    startPos: Pos;
    moved: boolean;
  } | null>(null);

  // Randomize only on the client, after mount — computing this during the
  // server render would produce a different layout than the client's first
  // paint and trip a hydration mismatch. Also measures the real content box
  // so icons never spawn on top of the text/console that needs to stay
  // readable, instead of just guessing at a center exclusion zone.
  useEffect(() => {
    const container = containerRef.current;
    const avoidEl = avoidRef?.current ?? null;
    let avoid: Rect | null = avoidRect ?? null;
    if (container && avoidEl) {
      const cRect = container.getBoundingClientRect();
      const aRect = avoidEl.getBoundingClientRect();
      avoid = {
        left: ((aRect.left - cRect.left) / cRect.width) * 100 - AVOID_PADDING,
        top: ((aRect.top - cRect.top) / cRect.height) * 100 - AVOID_PADDING,
        right: ((aRect.right - cRect.left) / cRect.width) * 100 + AVOID_PADDING,
        bottom: ((aRect.bottom - cRect.top) / cRect.height) * 100 + AVOID_PADDING,
      };
    }
    const avoidRects: Rect[] = [];
    if (avoid) avoidRects.push(avoid);
    if (chromeTopPct > 0) avoidRects.push({ left: 0, right: 100, top: 0, bottom: chromeTopPct });
    if (chromeBottomPct > 0) avoidRects.push({ left: 0, right: 100, top: 100 - chromeBottomPct, bottom: 100 });
    const cw = container?.getBoundingClientRect().width || window.innerWidth;
    const ch = container?.getBoundingClientRect().height || window.innerHeight;
    setPositions(randomPositions(tracks, avoidRects, cw, ch));
    // Re-shuffle when the avoid box's real numbers change (e.g. DesktopBackground
    // correcting its first-paint guess to a real viewport-derived value shortly
    // after mount, or a window resize) — deliberately keyed on the plain numbers,
    // not the avoidRect object reference, since a new inline object literal every
    // render would otherwise reposition icons constantly for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avoidRect?.left, avoidRect?.top, avoidRect?.right, avoidRect?.bottom, chromeTopPct, chromeBottomPct]);

  function handlePointerDown(e: React.PointerEvent, track: Track) {
    dragRef.current = {
      id: track.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPos: positions[track.id],
      moved: false,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore — dragging still works via bubbled pointer events either way
    }
  }

  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    const container = containerRef.current;
    if (!drag || !container) return;
    const rect = container.getBoundingClientRect();
    const dxPct = ((e.clientX - drag.startClientX) / rect.width) * 100;
    const dyPct = ((e.clientY - drag.startClientY) / rect.height) * 100;
    if (Math.abs(dxPct) > 0.3 || Math.abs(dyPct) > 0.3) drag.moved = true;
    const x = Math.min(96, Math.max(0, drag.startPos.x + dxPct));
    const y = Math.min(96, Math.max(0, drag.startPos.y + dyPct));
    setPositions((p) => ({ ...p, [drag.id]: { x, y } }));
  }

  function handlePointerUp(e: React.PointerEvent, track: Track) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag && !drag.moved) {
      onTrackClick(track);
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }

  if (Object.keys(positions).length === 0) return <div className="desktop-files" ref={containerRef} />;

  return (
    <div className="desktop-files" ref={containerRef}>
      {tracks.map((t) => {
        const pos = positions[t.id];
        if (!pos) return null;
        const active = playingTrackId === t.id;
        return (
          <div
            key={t.id}
            className={`desktop-file${active ? " active" : ""}`}
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            onPointerDown={(e) => handlePointerDown(e, t)}
            onPointerMove={handlePointerMove}
            onPointerUp={(e) => handlePointerUp(e, t)}
          >
            <div className="desktop-file-icon">
              {active ? (
                <span className={`track-eq mini${isPlaying ? " playing" : ""}`}>
                  <span />
                  <span />
                  <span />
                </span>
              ) : (
                <MusicIcon />
              )}
            </div>
            <div className="desktop-file-name">track-{t.index}.wav</div>
            <div className="desktop-file-title">{t.title}</div>
          </div>
        );
      })}
    </div>
  );
}

// Mobile has no persistent safe real estate the way desktop does — a wide
// viewport keeps generous, unbroken left/right margins around the centered
// max-width-1100px window at every scroll depth, but on a narrow phone that
// window (and the landing hero's own content column) runs edge to edge, so
// there is no side gutter at all. Scattering icons across one fixed-viewport
// grid (the desktop approach) doesn't work either: real content is several
// screens taller than the viewport, so a single guessed "avoid box" can
// only ever protect the first screen's worth — this is what caused icons to
// land directly on top of hero text once mobile support was re-attempted.
// Real fix: find the REAL gaps between real content blocks (measured live,
// not guessed) across the WHOLE page, and render icons as ordinary
// document-flow content at those exact gaps — position:absolute with no
// positioned ancestor resolves against the document, not the viewport, so
// these scroll away with the page exactly like real desktop icons sitting
// in genuinely empty space, instead of hovering fixed over whatever
// happens to be scrolled underneath. Naturally yields "fewer icons" too —
// most pages only have one or two gaps big enough to hold one.
const MOBILE_ICON_MIN_GAP = 90; // real icon footprint (~77px) + a little breathing room
const MOBILE_TASKBAR_BUFFER = 16; // just keeps the icon off the literal last pixel of the page
const MOBILE_CONTENT_SELECTOR = ".landing-content > *, .landing-art, .bio-section, .win95-window";

interface MobileSlot {
  top: number;
  left: number;
}

function computeMobileSlots(maxSlots: number): MobileSlot[] {
  if (typeof document === "undefined") return [];
  const scrollY = window.scrollY;
  const els = Array.from(document.querySelectorAll<HTMLElement>(MOBILE_CONTENT_SELECTOR));
  const rects = els
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({ top: r.top + scrollY, bottom: r.bottom + scrollY }))
    .sort((a, b) => a.top - b.top);

  if (rects.length === 0) return [];

  const docBottom = document.documentElement.scrollHeight - MOBILE_TASKBAR_BUFFER;
  const vw = window.innerWidth;
  const iconW = 84;
  const leftMin = 8;
  // Floating chrome (the chat tab, the mini player when a track is
  // playing) lives fixed to the bottom-right corner, independent of
  // document scroll — bias icons toward the left ~60% of the screen so a
  // gap near the bottom of the page doesn't routinely land an icon right
  // under it.
  const leftMax = Math.max(leftMin, vw * 0.6 - iconW);

  const gaps: { start: number; size: number }[] = [];
  for (let i = 0; i < rects.length - 1; i++) {
    const size = rects[i + 1].top - rects[i].bottom;
    if (size >= MOBILE_ICON_MIN_GAP) gaps.push({ start: rects[i].bottom, size });
  }
  // The site-taskbar is fixed to the VIEWPORT bottom, not a document
  // position — on a short page it can end up overlapping the tail gap at
  // whatever scroll position the page happens to load at. That's cosmetic
  // only, not a real collision: the taskbar's explicit z-index:50 always
  // wins both paint and hit-testing, so a temporarily-hidden icon can never
  // steal a click meant for the taskbar (same as any ordinary page content
  // running behind it). Bias the icon toward the TOP of the tail gap, right
  // after real content ends, rather than centering it — that's the position
  // least likely to be under the taskbar's sweep at first paint.
  const tailStart = rects[rects.length - 1].bottom;
  const tailSize = docBottom - tailStart;
  if (tailSize >= MOBILE_ICON_MIN_GAP) {
    gaps.push({ start: tailStart, size: Math.min(tailSize, MOBILE_ICON_MIN_GAP) });
  }

  return gaps.slice(0, maxSlots).map((g) => ({
    top: g.start + g.size / 2,
    left: Math.min(leftMax, Math.max(leftMin, leftMin + Math.random() * (leftMax - leftMin))),
  }));
}

export function MobileDesktopFiles({
  tracks,
  playingTrackId,
  isPlaying,
  onTrackClick,
  routeKey,
}: {
  tracks: Track[];
  playingTrackId: string | null;
  isPlaying: boolean;
  onTrackClick: (track: Track) => void;
  // Bump this (e.g. with usePathname()) to force a recompute on navigation —
  // gaps live at completely different document coordinates per page.
  routeKey: string;
}) {
  const [slots, setSlots] = useState<MobileSlot[]>([]);

  useEffect(() => {
    let cancelled = false;
    function recompute() {
      if (!cancelled) setSlots(computeMobileSlots(tracks.length));
    }
    // Real content (album art, fonts) can still be settling right after
    // navigation, so recompute isn't a single measurement — a few retries
    // catch layout shifts without needing a full MutationObserver.
    recompute();
    const t1 = setTimeout(recompute, 300);
    const t2 = setTimeout(recompute, 1000);
    window.addEventListener("resize", recompute);
    return () => {
      cancelled = true;
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener("resize", recompute);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, tracks.length]);

  const shown = tracks.slice(0, slots.length);

  return (
    <>
      {shown.map((t, i) => {
        const slot = slots[i];
        const active = playingTrackId === t.id;
        return (
          <div
            key={t.id}
            className={`desktop-file${active ? " active" : ""}`}
            style={{ top: `${slot.top}px`, left: `${slot.left}px` }}
            onClick={() => onTrackClick(t)}
          >
            <div className="desktop-file-icon">
              {active ? (
                <span className={`track-eq mini${isPlaying ? " playing" : ""}`}>
                  <span />
                  <span />
                  <span />
                </span>
              ) : (
                <MusicIcon />
              )}
            </div>
            <div className="desktop-file-name">track-{t.index}.wav</div>
            <div className="desktop-file-title">{t.title}</div>
          </div>
        );
      })}
    </>
  );
}
