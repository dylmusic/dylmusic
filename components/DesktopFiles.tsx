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
//
// STICKY, not a full reshuffle every call. This function re-runs on every
// avoid-box recompute (mount, a couple of settle-timer retries, window
// resize) — a real page's content box shifts by a few px multiple times
// early on (web fonts swapping in, images finishing layout), each of which
// changes the measured avoid rect slightly. An earlier version rebuilt
// EVERY track's position from scratch on every one of those calls, so a
// track that had a valid icon could lose it (and a different one gain one)
// purely because the Fisher-Yates shuffle came out differently that time —
// visually this read as icons randomly appearing and disappearing every
// time one of those recomputes fired, sometimes within the same second.
// Now: any track whose EXISTING position still clears the current avoid
// rects keeps it, untouched — only tracks with no position yet, or whose
// old position just became invalid, get (re)assigned from the free cells.
function computePositions(
  tracks: Track[],
  avoidRects: Rect[],
  containerWidthPx: number,
  containerHeightPx: number,
  prevPositions: Record<string, Pos>
): Record<string, Pos> {
  const cellW = 100 / GRID_COLS;
  const cellH = 100 / GRID_ROWS;
  // Jitter can move a cell up to ~20% of a cell's size off its grid center.
  const jitterPadX = cellW * 0.2;
  const jitterPadY = cellH * 0.2;
  // `x`/`y` (and the CSS `left`/`top` they become) are the icon's CENTER —
  // `.desktop-file` renders with `transform: translate(-50%, -50%)` — so a
  // real 84x76px box extends symmetrically half its width/height in every
  // direction from the point being tested here. An earlier version treated
  // (x,y) as the box's top-left corner and padded the avoid rect by the
  // icon's FULL size on only the left/top side (since the box could only
  // extend right/down from a corner) — mathematically fine for preventing
  // overlap, but it made the safe margin on the left of any centered
  // content box strictly smaller than the safe margin on the right.
  // Confirmed live: at common desktop widths every surviving grid column
  // ended up on the right, none on the left — not random, just biased.
  // Symmetric half-size padding on all four sides fixes that.
  const iconWPct = containerWidthPx > 0 ? (ICON_WIDTH_PX / containerWidthPx) * 100 : 0;
  const iconHPct = containerHeightPx > 0 ? (ICON_HEIGHT_PX / containerHeightPx) * 100 : 0;
  const padded = avoidRects.map((r) => ({
    left: r.left - jitterPadX - iconWPct / 2,
    right: r.right + jitterPadX + iconWPct / 2,
    top: r.top - jitterPadY - iconHPct / 2,
    bottom: r.bottom + jitterPadY + iconHPct / 2,
  }));
  const overlapsAvoid = (x: number, y: number) => padded.some((r) => rectsOverlap(x, y, r));

  // With a center anchor, the box extends half its size in every
  // direction, so the center itself needs to stay at least half a
  // width/height away from each edge to avoid clipping off-screen.
  const xMin = Math.max(1, iconWPct / 2);
  const xMax = Math.min(99, 100 - iconWPct / 2);
  const yMin = Math.max(2, iconHPct / 2);
  const yMax = Math.min(98, 100 - iconHPct / 2);
  const inBounds = (x: number, y: number) => x >= xMin && x <= xMax && y >= yMin && y <= yMax;

  // Keep any track whose existing position still clears the current avoid
  // rects and is still in-bounds — this is the whole fix for the
  // flicker/disappear bug described above. Only tracks with no usable
  // existing position fall through to a fresh cell assignment below.
  const positions: Record<string, Pos> = {};
  const needsAssignment: Track[] = [];
  for (const t of tracks) {
    const prev = prevPositions[t.id];
    if (prev && !overlapsAvoid(prev.x, prev.y) && inBounds(prev.x, prev.y)) {
      positions[t.id] = prev;
    } else {
      needsAssignment.push(t);
    }
  }
  if (needsAssignment.length === 0) return positions;

  const kept = Object.values(positions);
  // Half a cell's size as the minimum spacing from an already-kept icon —
  // same reasoning as the old "one cell per track, never reused" rule
  // (two icons sharing a cell's worth of space made one unclickable), just
  // measured directly instead of via the grid index.
  const tooCloseToKept = (x: number, y: number) =>
    kept.some((p) => Math.abs(p.x - x) < cellW * 0.5 && Math.abs(p.y - y) < cellH * 0.5);

  const cells: { x: number; y: number }[] = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const x = ((col + 0.5) / GRID_COLS) * 100;
      const y = ((row + 0.5) / GRID_ROWS) * 100;
      if (overlapsAvoid(x, y) || tooCloseToKept(x, y)) continue;
      cells.push({ x, y });
    }
  }

  // Fisher-Yates shuffle — genuinely random among the cells actually being
  // filled in this pass, without disturbing anything already kept above.
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }

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
  const count = Math.min(needsAssignment.length, cells.length);
  for (let i = 0; i < count; i++) {
    const cell = cells[i];
    const jitterX = (Math.random() - 0.5) * cellW * 0.4;
    const jitterY = (Math.random() - 0.5) * cellH * 0.4;
    positions[needsAssignment[i].id] = {
      x: Math.min(xMax, Math.max(xMin, cell.x + jitterX)),
      y: Math.min(yMax, Math.max(yMin, cell.y + jitterY)),
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
    // Functional update, not a plain computed value — computePositions needs
    // to see whatever's already placed (including anything the user just
    // dragged) so it can keep it, rather than starting from a blank slate
    // every time this effect re-fires. See computePositions' own comment.
    setPositions((prev) => computePositions(tracks, avoidRects, cw, ch, prev));
    // Re-run when the avoid box's real numbers change (e.g. DesktopBackground
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
    // Same center-anchor half-size margin as the initial random placement
    // (see randomPositions) — keeps a dragged icon from being pulled so far
    // it clips off-screen, now that (x,y) is the icon's center, not corner.
    const iconWPct = rect.width > 0 ? (ICON_WIDTH_PX / rect.width) * 100 : 0;
    const iconHPct = rect.height > 0 ? (ICON_HEIGHT_PX / rect.height) * 100 : 0;
    const x = Math.min(100 - iconWPct / 2, Math.max(iconWPct / 2, drag.startPos.x + dxPct));
    const y = Math.min(100 - iconHPct / 2, Math.max(iconHPct / 2, drag.startPos.y + dyPct));
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
const MOBILE_ICON_MIN_GAP = 85; // real icon footprint (~77px) + a little breathing room
const MOBILE_TASKBAR_BUFFER = 16; // just keeps the icon off the literal last pixel of the page
// .bio-section itself (not its children) was treated as ONE opaque block
// end to end — real content across most pages left only a single usable
// gap (the trailing space after all content, right before the taskbar),
// which read as "icons basically don't exist on mobile." Drilling into
// BioSection's own real children instead of its outer wrapper surfaces a
// genuine (if narrow — ~89px, confirmed live) gap between the album art
// and the bio section that was otherwise hidden inside that one big box.
// MUST include the section's own <h2> here too, not just its eyebrow/copy/
// stats — a first version of this selector omitted it, which made the gap
// detector think the ~62px the heading actually occupies was empty space,
// and a real icon landed directly on top of "Rapping about crypto..."
// (caught live via a full-page screenshot, not assumed fixed).
const MOBILE_CONTENT_SELECTOR =
  ".landing-content > *, .landing-art, .bio-eyebrow, .bio-section h2, .bio-copy, .bio-stats, .win95-window";

interface MobileSlot {
  top: number;
  left: number;
}

function computeMobileSlots(maxSlots: number, leftCache: Map<number, number>): MobileSlot[] {
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
  // `left`/`top` are now the icon's CENTER (`.desktop-file` renders with
  // `transform: translate(-50%, -50%)`, matching the desktop placement
  // convention below) — leftMin has to clear half the icon's width or it
  // clips off the left edge of the screen.
  const leftMin = iconW / 2 + 4;
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

  return gaps.slice(0, maxSlots).map((g) => {
    // `start` (rounded to the nearest 10px) keys a real content gap, which
    // is stable across recomputes on the same page — reusing it instead of
    // re-rolling Math.random() every time this runs (mount, settle-timer
    // retries, every resize) stops the icon's horizontal position from
    // visibly jumping around on each of those, on top of the recompute
    // debounce below.
    const key = Math.round(g.start / 10) * 10;
    let left = leftCache.get(key);
    if (left === undefined) {
      left = Math.min(leftMax, Math.max(leftMin, leftMin + Math.random() * (leftMax - leftMin)));
      leftCache.set(key, left);
    }
    return { top: g.start + g.size / 2, left };
  });
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
  const leftCacheRef = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    leftCacheRef.current = new Map();
    let cancelled = false;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    function recompute() {
      if (!cancelled) setSlots(computeMobileSlots(tracks.length, leftCacheRef.current));
    }
    // Debounced, not immediate — mobile browsers fire "resize" repeatedly
    // while the address bar collapses/expands during ordinary scrolling
    // (not just on an actual viewport-size change), so an undebounced
    // listener here was recomputing dozens of times during a single
    // scroll gesture. Each recompute re-measures real DOM rects, and a
    // gap sitting right at the MOBILE_ICON_MIN_GAP threshold could flicker
    // in and out across those measurements — this is what made icons look
    // like they were randomly disappearing while using the site, on top
    // of the same issue the settle-timer retries below could also cause.
    function debouncedRecompute() {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(recompute, 200);
    }
    // Real content (album art, fonts) can still be settling right after
    // navigation, so recompute isn't a single measurement — a few retries
    // catch layout shifts without needing a full MutationObserver.
    recompute();
    const t1 = setTimeout(recompute, 300);
    const t2 = setTimeout(recompute, 1000);
    window.addEventListener("resize", debouncedRecompute);
    return () => {
      cancelled = true;
      clearTimeout(t1);
      clearTimeout(t2);
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener("resize", debouncedRecompute);
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
            className={`desktop-file desktop-file-tap${active ? " active" : ""}`}
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
