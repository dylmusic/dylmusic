"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { Album, CHAINS, ChainKey, Track } from "@/lib/albums";
import { recordStream } from "@/lib/streams";
import ConsolePanel from "./ConsolePanel";
import BioSection from "./BioSection";
import Visualizer from "./Visualizer";
import MiniPlayer from "./MiniPlayer";
import DesktopFiles from "./DesktopFiles";

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

  const audioRef = useRef<HTMLAudioElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [playingTrack, setPlayingTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

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

  function toggleTrack(t: Track) {
    const audio = audioRef.current;
    if (!audio) return;
    ensureAudioGraph();
    if (audioCtxRef.current?.state === "suspended") audioCtxRef.current.resume();

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
    <div className="landing-page">
      <div
        className="landing"
        style={{ "--glow-color": activeChain.color } as React.CSSProperties}
      >
        <Visualizer color={activeChain.color} analyser={isPlaying ? analyser : null} />
        <DesktopFiles
          tracks={album.tracks}
          playingTrackId={playingTrack?.id ?? null}
          isPlaying={isPlaying}
          onTrackClick={toggleTrack}
        />
        <audio
          ref={audioRef}
          loop
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        />

        <div className="landing-inner">
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
              album={album}
              previewPlaying={isPlaying && playingTrack?.id === titleTrack.id}
              previewTitle={titleTrack.title}
              onTogglePreview={() => toggleTrack(titleTrack)}
            />
          </div>
        </div>
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
          onToggle={() => toggleTrack(playingTrack)}
          onClose={closePlayer}
          onRequestConnect={onConnect}
          onSeek={seek}
        />
      )}
    </div>
  );
}
