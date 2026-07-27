"use client";

import { Track } from "@/lib/albums";

export default function MiniPlayer({
  track,
  isPlaying,
  onToggle,
  onClose,
}: {
  track: Track;
  isPlaying: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  return (
    <div className="mini-player">
      <button className="mini-player-toggle" onClick={onToggle} aria-label={isPlaying ? "Pause" : "Play"}>
        {isPlaying ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <rect x="2" y="1" width="4" height="12" rx="1" />
            <rect x="8" y="1" width="4" height="12" rx="1" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <path d="M2.5 1.2c0-.9 1-1.4 1.7-.9l9 5.8c.7.4.7 1.4 0 1.8l-9 5.8c-.7.5-1.7 0-1.7-.9V1.2Z" />
          </svg>
        )}
      </button>
      <div className="mini-player-info">
        <span className={`track-eq mini${isPlaying ? " playing" : ""}`}>
          <span />
          <span />
          <span />
        </span>
        <span className="mini-player-title">{track.title}</span>
      </div>
      <button className="mini-player-close" onClick={onClose} aria-label="Close player">
        ×
      </button>
    </div>
  );
}
