"use client";

import { createContext, useContext, useRef, useState } from "react";
import { ALBUMS, Track } from "@/lib/albums";
import { recordStream } from "@/lib/streams";

const ALL_TRACKS: Track[] = ALBUMS.flatMap((a) => a.tracks);

interface PlayerState {
  playingTrack: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  canGoPrev: boolean;
  toggleTrack: (t: Track, queue?: Track[]) => void;
  playNext: () => void;
  playPrev: () => void;
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
  const [queue, setQueue] = useState<Track[]>([]);
  const [history, setHistory] = useState<Track[]>([]);

  function playTrack(t: Track, newQueue: Track[], pushHistory: boolean) {
    const audio = audioRef.current;
    if (!audio) return;
    if (pushHistory && playingTrack) setHistory((h) => [...h, playingTrack]);
    audio.src = t.audioSrc;
    audio.play().catch(() => {});
    setPlayingTrack(t);
    setQueue(newQueue);
    recordStream(t);
  }

  function toggleTrack(t: Track, q?: Track[]) {
    const audio = audioRef.current;
    if (!audio) return;
    if (playingTrack?.id === t.id) {
      if (isPlaying) audio.pause();
      else audio.play().catch(() => {});
      return;
    }
    playTrack(t, q && q.length ? q : [t], true);
  }

  // On an album, "next" moves to the next track in that album's order;
  // outside a known queue (or at the end of one) it shuffles to something
  // else from the full catalog instead of just stopping.
  function playNext() {
    if (!playingTrack) return;
    const idx = queue.findIndex((x) => x.id === playingTrack.id);
    if (idx >= 0 && idx < queue.length - 1) {
      playTrack(queue[idx + 1], queue, true);
      return;
    }
    const pool = ALL_TRACKS.filter((x) => x.id !== playingTrack.id);
    if (pool.length === 0) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    playTrack(pick, [pick], true);
  }

  // "Backwards" always means the track that was actually playing before
  // this one, not a position in the current queue.
  function playPrev() {
    if (history.length === 0) return;
    const last = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    playTrack(last, queue.some((x) => x.id === last.id) ? queue : [last], false);
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
      value={{
        playingTrack,
        isPlaying,
        currentTime,
        duration,
        canGoPrev: history.length > 0,
        toggleTrack,
        playNext,
        playPrev,
        seek,
        closePlayer,
      }}
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
