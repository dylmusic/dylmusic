"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Album, ALBUMS, CHAINS, ChainKey, Track } from "@/lib/albums";
import { recordStream } from "@/lib/streams";
import ConsolePanel from "./ConsolePanel";
import BioSection from "./BioSection";
import Visualizer from "./Visualizer";
import MiniPlayer from "./MiniPlayer";
import DesktopFiles from "./DesktopFiles";
import StartMenu from "./StartMenu";

const ALL_TRACKS: Track[] = ALBUMS.flatMap((a) => a.tracks);

// Same pixel-note shape as the desktop file icons, reused on the taskbar
// Start button so the "menu" and the "files" read as one icon family.
const STAR_ICON_PIXELS: [number, number][] = [
  [7, 1], [7, 2], [7, 3], [7, 4], [7, 5],
  [8, 1], [8, 2], [9, 2],
  [5, 5], [6, 5],
  [4, 6], [5, 6], [6, 6],
  [3, 7], [4, 7], [5, 7], [6, 7],
  [3, 8], [4, 8], [5, 8], [6, 8],
  [4, 9], [5, 9],
];

export default function Landing({
  chain,
  onSelectChain,
  onConnect,
  album,
  alreadyConnected = false,
  walletAddress = null,
}: {
  chain: ChainKey;
  onSelectChain: (chain: ChainKey) => void;
  onConnect: () => void;
  album: Album;
  alreadyConnected?: boolean;
  walletAddress?: string | null;
}) {
  const activeChain = CHAINS.find((c) => c.key === chain)!;
  const titleTrack = album.tracks[album.tracks.length - 1];

  const innerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [playingTrack, setPlayingTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [clock, setClock] = useState<string | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [queue, setQueue] = useState<Track[]>([]);
  const [history, setHistory] = useState<Track[]>([]);

  useEffect(() => {
    function tick() {
      setClock(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    }
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);

  function ensureAudioGraph() {
    const audio = audioRef.current;
    if (!audio || audioCtxRef.current) return;
    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const source = ctx.createMediaElementSource(audio);
    const node = ctx.createAnalyser();
    node.fftSize = 128;
    node.smoothingTimeConstant = 0.8;
    source.connect(node);
    node.connect(ctx.destination);
    audioCtxRef.current = ctx;
    setAnalyser(node);
  }

  function playTrack(t: Track, newQueue: Track[], pushHistory: boolean) {
    const audio = audioRef.current;
    if (!audio) return;
    ensureAudioGraph();
    if (audioCtxRef.current?.state === "suspended") audioCtxRef.current.resume();
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
      ensureAudioGraph();
      if (audioCtxRef.current?.state === "suspended") audioCtxRef.current.resume();
      if (isPlaying) audio.pause();
      else audio.play().catch(() => {});
      return;
    }
    playTrack(t, q && q.length ? q : [t], true);
  }

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
    <div className="landing-page" style={{ "--accent": activeChain.color } as React.CSSProperties}>
      <div className="landing">
        <Visualizer color={activeChain.color} analyser={isPlaying ? analyser : null} />
        <DesktopFiles
          tracks={album.tracks}
          playingTrackId={playingTrack?.id ?? null}
          isPlaying={isPlaying}
          onTrackClick={toggleTrack}
          avoidRef={innerRef}
        />
        <audio
          ref={audioRef}
          loop
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        />

        <div className="landing-inner" ref={innerRef}>
          <div className="landing-content">
            <Image
              src="/brand/dyl-logo-white.png"
              alt="Dyl"
              width={92}
              height={74}
              className="landing-logo"
              priority
            />

            <div className="landing-tagline">the OG crypto rapper</div>

            <h1>Only 100 NFTs per song on each chain</h1>

            <div className="landing-price">Every mint starts at $0.99</div>
            <div className="landing-price">Buy with any coin from any chain</div>

            <div className="landing-chain-select">
              <div className="chain-switch landing-chain-switch" role="tablist" aria-label="Select chain">
                {CHAINS.map((c) => (
                  <button
                    key={c.key}
                    role="tab"
                    aria-selected={chain === c.key}
                    className={`chain-pill${chain === c.key ? " active" : ""}`}
                    style={
                      chain === c.key
                        ? ({ "--chain-color": c.color } as React.CSSProperties)
                        : undefined
                    }
                    onClick={() => onSelectChain(c.key)}
                  >
                    <span className="chain-dot" style={{ background: c.color }} />
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <button className="btn-connect" onClick={onConnect}>
              {alreadyConnected ? "Enter App" : "Connect Wallet"}
            </button>
          </div>

          <div className="landing-art">
            <ConsolePanel
              albums={ALBUMS}
              previewPlaying={isPlaying && playingTrack?.id === titleTrack.id}
              previewTitle={titleTrack.title}
              onTogglePreview={() => toggleTrack(titleTrack)}
            />
          </div>
        </div>

        <div className="landing-taskbar">
          <button className="taskbar-start" onClick={() => setStartOpen((v) => !v)}>
            <svg width="12" height="12" viewBox="0 0 12 12" shapeRendering="crispEdges">
              {STAR_ICON_PIXELS.map(([x, y], i) => (
                <rect key={i} x={x} y={y} width="1" height="1" fill="#04140a" />
              ))}
            </svg>
            Start
          </button>
          <span className="taskbar-clock">{clock ?? "--:--"}</span>
        </div>

        {startOpen && (
          <StartMenu
            allTracks={album.tracks}
            chain={chain}
            walletAddress={walletAddress}
            onRequestConnect={onConnect}
            playingTrackId={playingTrack?.id ?? null}
            isPlaying={isPlaying}
            onTogglePlay={toggleTrack}
            onClose={() => setStartOpen(false)}
          />
        )}
      </div>

      <BioSection />

      {playingTrack && (
        <MiniPlayer
          track={playingTrack}
          chain={chain}
          walletAddress={walletAddress}
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          canGoPrev={history.length > 0}
          onToggle={() => toggleTrack(playingTrack)}
          onClose={closePlayer}
          onRequestConnect={onConnect}
          onSeek={seek}
          onPrev={playPrev}
          onNext={playNext}
        />
      )}
    </div>
  );
}
