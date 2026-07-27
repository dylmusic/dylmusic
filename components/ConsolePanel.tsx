"use client";

import { useRef, useState } from "react";
import { Album } from "@/lib/albums";
import { platformOverview } from "@/lib/platformStats";

export default function ConsolePanel({
  albums,
  previewPlaying,
  previewTitle,
  onTogglePreview,
}: {
  albums: Album[];
  previewPlaying: boolean;
  previewTitle: string;
  onTogglePreview: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const liveAlbum = albums[0];
  const liveCount = albums.filter((a) => !a.comingSoon).length;
  const overview = platformOverview(liveAlbum);

  function handleMove(e: React.PointerEvent<HTMLDivElement>) {
    const el = stageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    setTilt({ x: (0.5 - py) * 16, y: (px - 0.5) * 20 });
  }

  function handleLeave() {
    setTilt({ x: 0, y: 0 });
  }

  return (
    <div
      ref={stageRef}
      className="console-stage"
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
    >
      <div
        className="console-panel"
        style={{ transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` }}
      >
        <div className="console-header">
          <span className="console-status">
            <span className="console-status-dot" /> LIVE
          </span>
          <button
            className={`console-preview-btn${previewPlaying ? " playing" : ""}`}
            onClick={onTogglePreview}
            title={previewPlaying ? "Pause preview" : `Play a preview of "${previewTitle}"`}
          >
            {previewPlaying ? (
              <svg width="9" height="9" viewBox="0 0 14 14" fill="currentColor">
                <rect x="2" y="1" width="4" height="12" rx="1" />
                <rect x="8" y="1" width="4" height="12" rx="1" />
              </svg>
            ) : (
              <svg width="9" height="9" viewBox="0 0 14 14" fill="currentColor">
                <path d="M2.5 1.2c0-.9 1-1.4 1.7-.9l9 5.8c.7.4.7 1.4 0 1.8l-9 5.8c-.7.5-1.7 0-1.7-.9V1.2Z" />
              </svg>
            )}
            {previewPlaying ? "Playing" : "Play Music"}
          </button>
        </div>

        <div className="console-log">
          <div className="console-log-prompt">
            <span className="console-log-caret">$</span> dyl.sys --status
          </div>
          <div className="console-log-row">
            <span>catalog</span>
            <span>
              {albums.length} albums ({liveCount} live)
            </span>
          </div>
          <div className="console-log-row">
            <span>tracks</span>
            <span>{liveAlbum.tracks.length} indexed</span>
          </div>
          <div className="console-log-row">
            <span>chains</span>
            <span>{overview.perChain.map((c) => c.chain.shortLabel.toLowerCase()).join(" · ")}</span>
          </div>
          <div className="console-log-row">
            <span>sold</span>
            <span>{Math.round(overview.totalPct)}% across all chains</span>
          </div>
          <div className="console-log-cursor" />
        </div>

        <div className="console-chains">
          {overview.perChain.map(({ chain, stat }) => (
            <div key={chain.key} className="console-chain-meter">
              <div className="console-chain-top">
                <span className="chain-dot" style={{ background: chain.color }} />
                <span>{chain.shortLabel}</span>
                <span className="console-chain-pct">{Math.round(stat.pct)}%</span>
              </div>
              <div className="console-meter-track">
                <div
                  className="console-meter-fill"
                  style={{ width: `${stat.pct}%`, background: chain.color }}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="console-footer">
          <span>{albums.length} ALBUMS</span>
          <span>·</span>
          <span>{liveAlbum.tracks.length} TRACKS</span>
          <span>·</span>
          <span>3 CHAINS</span>
        </div>
      </div>
    </div>
  );
}
