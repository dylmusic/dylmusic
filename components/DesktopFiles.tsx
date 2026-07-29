"use client";

import { useEffect, useRef, useState } from "react";
import { Track } from "@/lib/albums";

interface Pos {
  x: number; // percent of container width
  y: number; // percent of container height
}

// Back to the original simple approach after several rounds of a
// "content-aware" version (measuring the real content box + fixed chrome,
// excluding those regions, reshuffling on every resize/settle-retry) kept
// producing new bugs — icons clustering on one side, a scroll-blocking
// touch-action regression, and worst of all a position-recompute effect
// that fired several times per page load and fully reshuffled every icon
// from scratch each time, which looked like icons randomly appearing and
// disappearing. Dylan's call after that: go back to the plain random
// scatter (edge-biased, genuinely random on every load, no collision
// detection against real content) — some icons land under hero text and
// aren't clickable there, most aren't, and that tradeoff is preferred over
// the "smart" version's instability. One shared implementation for both
// desktop and mobile now (no separate mobile gap-detection system) — on
// mobile this renders exactly like desktop, fixed to the viewport, so
// scrolling the page does NOT reveal new/different icons the way the
// document-flow mobile version did.
const GRID_COLS = 6;
const GRID_ROWS = 5;

function randomPositions(tracks: Track[]): Record<string, Pos> {
  const cells: { x: number; y: number }[] = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      cells.push({
        x: ((col + 0.5) / GRID_COLS) * 100,
        y: ((row + 0.5) / GRID_ROWS) * 100,
      });
    }
  }

  // Bias toward cells farthest from dead-center (roughly where the
  // headline/console sit) so icons mostly land in the open margins, with
  // enough randomness mixed in that it's genuinely different every load.
  cells.sort((a, b) => {
    const da = Math.hypot(a.x - 50, a.y - 50);
    const db = Math.hypot(b.x - 50, b.y - 50);
    return db - da + (Math.random() - 0.5) * 20;
  });

  const cellW = 100 / GRID_COLS;
  const cellH = 100 / GRID_ROWS;

  const positions: Record<string, Pos> = {};
  tracks.forEach((t, i) => {
    const cell = cells[i % cells.length];
    const jitterX = (Math.random() - 0.5) * cellW * 0.7;
    const jitterY = (Math.random() - 0.5) * cellH * 0.7;
    positions[t.id] = {
      x: Math.min(96, Math.max(2, cell.x + jitterX)),
      y: Math.min(96, Math.max(3, cell.y + jitterY)),
    };
  });

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
}: {
  tracks: Track[];
  playingTrackId: string | null;
  isPlaying: boolean;
  onTrackClick: (track: Track) => void;
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
  // paint and trip a hydration mismatch. Computed exactly once — no
  // recompute on resize/settle timers, which is what caused the
  // appear-then-disappear flicker in the previous "content-aware" version.
  useEffect(() => {
    setPositions(randomPositions(tracks));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
