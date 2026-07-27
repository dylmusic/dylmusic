"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { Album, CHAINS, ChainKey } from "@/lib/albums";
import ConsolePanel from "./ConsolePanel";
import BioSection from "./BioSection";
import Visualizer from "./Visualizer";
import MiniPlayer from "./MiniPlayer";

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
  const previewTrack = album.tracks[album.tracks.length - 1];

  const previewAudioRef = useRef<HTMLAudioElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewShown, setPreviewShown] = useState(false);

  function togglePreview() {
    const audio = previewAudioRef.current;
    if (!audio) return;

    if (!audioCtxRef.current) {
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

    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }

    if (previewPlaying) {
      audio.pause();
    } else {
      audio.play().catch(() => {});
      setPreviewShown(true);
    }
  }

  function closePreview() {
    const audio = previewAudioRef.current;
    if (audio) audio.pause();
    setPreviewShown(false);
  }

  return (
    <div className="landing-page">
      <div
        className="landing"
        style={{ "--glow-color": activeChain.color } as React.CSSProperties}
      >
        <Visualizer color={activeChain.color} analyser={previewPlaying ? analyser : null} />
        <audio
          ref={previewAudioRef}
          src={previewTrack.audioSrc}
          loop
          onPlay={() => setPreviewPlaying(true)}
          onPause={() => setPreviewPlaying(false)}
        />

        <div className="landing-inner">
          <div className="landing-content">
            <Image
              src="/brand/dyl-logo-white.png"
              alt="dyl"
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
              previewPlaying={previewPlaying}
              previewTitle={previewTrack.title}
              onTogglePreview={togglePreview}
            />
          </div>
        </div>
      </div>

      <BioSection />

      {previewShown && (
        <MiniPlayer
          track={previewTrack}
          chain={chain}
          walletAddress={walletAddress}
          isPlaying={previewPlaying}
          onToggle={togglePreview}
          onClose={closePreview}
          onRequestConnect={onConnect}
        />
      )}
    </div>
  );
}
