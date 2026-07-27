"use client";

import { useEffect, useRef, useState } from "react";
import { Track } from "@/lib/albums";

interface Pos {
  x: number; // percent of container width
  y: number; // percent of container height
}

// Grid the whole screen into cells, shuffle them, and bias toward the ones
// farthest from dead-center (roughly where the headline/console sit) so
// icons mostly land in the open margins — genuinely random on every load,
// not seeded. A few landing under the content occasionally is fine.
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

function MusicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M6 11.5V2.8c0-.3.2-.55.5-.6l6-1.1c.35-.07.7.2.7.57v7.03"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="4.3" cy="11.5" r="1.9" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="11.5" cy="9.9" r="1.9" stroke="currentColor" strokeWidth="1.1" />
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
  // paint and trip a hydration mismatch.
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
