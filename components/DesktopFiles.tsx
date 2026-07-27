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

const GRID_COLS = 8;
const GRID_ROWS = 7;
const AVOID_PADDING = 5; // percent, extra buffer around the real content box

function rectsOverlap(cellX: number, cellY: number, r: Rect): boolean {
  return cellX >= r.left && cellX <= r.right && cellY >= r.top && cellY <= r.bottom;
}

// Grid the whole screen into cells, drop any that land on/near the real
// content box (measured live, not guessed), then randomly assign whatever's
// left to tracks — genuinely different on every load, but never renders an
// icon on top of text that needs to stay readable.
function randomPositions(tracks: Track[], avoid: Rect | null): Record<string, Pos> {
  const cells: { x: number; y: number }[] = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const x = ((col + 0.5) / GRID_COLS) * 100;
      const y = ((row + 0.5) / GRID_ROWS) * 100;
      if (avoid && rectsOverlap(x, y, avoid)) continue;
      cells.push({ x, y });
    }
  }

  // Fisher-Yates shuffle for genuine randomness on each load.
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }

  const cellW = 100 / GRID_COLS;
  const cellH = 100 / GRID_ROWS;
  const pool = cells.length > 0 ? cells : [{ x: 50, y: 50 }];

  const positions: Record<string, Pos> = {};
  tracks.forEach((t, i) => {
    const cell = pool[i % pool.length];
    const jitterX = (Math.random() - 0.5) * cellW * 0.6;
    const jitterY = (Math.random() - 0.5) * cellH * 0.6;
    positions[t.id] = {
      x: Math.min(97, Math.max(1, cell.x + jitterX)),
      y: Math.min(97, Math.max(2, cell.y + jitterY)),
    };
  });

  return positions;
}

// A blocky, pixel-art music note — hand-placed 1px squares on a 12x12 grid,
// crisp edges (no anti-aliasing) for that Windows-95-icon feel.
const NOTE_PIXELS: [number, number][] = [
  [7, 1], [8, 1],
  [7, 2], [8, 2],
  [7, 3], [8, 3],
  [7, 4], [8, 4],
  [7, 5], [8, 5], [9, 5], [10, 5],
  [7, 6], [8, 6], [9, 6], [10, 6],
  [2, 8], [3, 8], [4, 8],
  [1, 9], [2, 9], [3, 9], [4, 9], [5, 9],
  [1, 10], [2, 10], [3, 10], [4, 10], [5, 10],
  [2, 11], [3, 11], [4, 11],
];

function MusicIcon() {
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
}: {
  tracks: Track[];
  playingTrackId: string | null;
  isPlaying: boolean;
  onTrackClick: (track: Track) => void;
  avoidRef: React.RefObject<HTMLElement>;
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
    const avoidEl = avoidRef.current;
    let avoid: Rect | null = null;
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
    setPositions(randomPositions(tracks, avoid));
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
