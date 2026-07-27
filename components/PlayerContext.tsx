"use client";

import { createContext, useContext, useRef, useState } from "react";
import { Track } from "@/lib/albums";
import { recordStream } from "@/lib/streams";

interface PlayerState {
  playingTrack: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  toggleTrack: (t: Track) => void;
  seek: (time: number) => void;
  closePlayer: () => void;
}

const PlayerContext = createContext<PlayerState | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playingTrack, setPlayingTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  function toggleTrack(t: Track) {
    const audio = audioRef.current;
    if (!audio) return;
    if (playingTrack?.id === t.id) {
      if (isPlaying) audio.pause();
      else audio.play().catch(() => {});
      return;
    }
    audio.src = t.audioSrc;
    audio.play().catch(() => {});
    setPlayingTrack(t);
    recordStream(t);
  }

  function seek(time: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = time;
    setCurrentTime(time);
  }

  function closePlayer() {
    const audio = audioRef.current;
    if (audio) audio.pause();
    setPlayingTrack(null);
  }

  return (
    <PlayerContext.Provider
      value={{ playingTrack, isPlaying, currentTime, duration, toggleTrack, seek, closePlayer }}
    >
      <audio
        ref={audioRef}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
      />
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerState {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}
