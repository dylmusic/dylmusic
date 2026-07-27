"use client";

import { useRef, useState } from "react";
import { Track } from "@/lib/albums";

interface Pos {
  x: number; // percent of container width
  y: number; // percent of container height
}

function seededRand(seed: number): number {
  const x = Math.sin(seed * 999.7) * 10000;
  return x - Math.floor(x);
}

function initialPositions(tracks: Track[]): Record<string, Pos> {
  const positions: Record<string, Pos> = {};
  const left = tracks.filter((_, i) => i % 2 === 0);
  const right = tracks.filter((_, i) => i % 2 === 1);

  [left, right].forEach((group, side) => {
    const slotH = 92 / group.length;
    group.forEach((t, i) => {
      const jitterX = (seededRand(t.index * 3 + 1) - 0.5) * 10;
      const jitterY = (seededRand(t.index * 7 + 2) - 0.5) * (slotH * 0.5);
      const baseX = side === 0 ? 10 : 90;
      positions[t.id] = {
        x: Math.min(95, Math.max(1, baseX + jitterX)),
        y: Math.min(95, Math.max(3, 4 + slotH * i + slotH / 2 + jitterY)),
      };
    });
  });

  return positions;
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
  const [positions, setPositions] = useState<Record<string, Pos>>(() => initialPositions(tracks));
  const dragRef = useRef<{
    id: string;
    startClientX: number;
    startClientY: number;
    startPos: Pos;
    moved: boolean;
  } | null>(null);

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
                <svg width="16" height="18" viewBox="0 0 16 18" fill="none">
                  <path
                    d="M1 1h9l5 5v11H1V1Z"
                    fill="rgba(124,255,107,0.08)"
                    stroke="currentColor"
                    strokeWidth="1"
                  />
                  <path d="M10 1v5h5" stroke="currentColor" strokeWidth="1" fill="none" />
                </svg>
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
