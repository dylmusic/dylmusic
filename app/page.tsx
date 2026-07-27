"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { ChainKey, CRYPTO_RICH_DELUXE, Track } from "@/lib/albums";
import { useSolanaWallet } from "@/lib/solana";
import Landing from "@/components/Landing";
import ChainSwitcher from "@/components/ChainSwitcher";
import WalletPill from "@/components/WalletPill";
import AlbumView from "@/components/AlbumView";
import MultichainOverview from "@/components/MultichainOverview";
import MiniPlayer from "@/components/MiniPlayer";

type View = "album" | "dashboard";

export default function Home() {
  const [chain, setChain] = useState<ChainKey>("base");
  const [view, setView] = useState<View>("album");

  const { address: evmAddress } = useAccount();
  const { disconnect: disconnectEvm } = useDisconnect();
  const { openConnectModal } = useConnectModal();

  const sol = useSolanaWallet();

  const connected = !!evmAddress || !!sol.address;
  const activeWallet = chain === "solana" ? sol.address : evmAddress ?? null;

  const audioRef = useRef<HTMLAudioElement>(null);
  const [playingTrack, setPlayingTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

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
  }

  function closePlayer() {
    const audio = audioRef.current;
    if (audio) audio.pause();
    setPlayingTrack(null);
  }

  function requestConnect() {
    if (chain === "solana") sol.connect();
    else openConnectModal?.();
  }

  if (!connected) {
    return (
      <Landing
        chain={chain}
        onSelectChain={setChain}
        onConnect={requestConnect}
        album={CRYPTO_RICH_DELUXE}
      />
    );
  }

  return (
    <div className="app-shell">
      <audio
        ref={audioRef}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      />

      <header className="app-header">
        <div className="app-header-left">
          <Image
            src="/brand/dyl-logo-white.png"
            alt="dyl"
            width={40}
            height={32}
            className="app-logo-img"
          />
          <div className="view-switch" role="tablist" aria-label="Select view">
            <button
              role="tab"
              aria-selected={view === "album"}
              className={`view-tab${view === "album" ? " active" : ""}`}
              onClick={() => setView("album")}
            >
              Album
            </button>
            <button
              role="tab"
              aria-selected={view === "dashboard"}
              className={`view-tab${view === "dashboard" ? " active" : ""}`}
              onClick={() => setView("dashboard")}
            >
              Dashboard
            </button>
          </div>
        </div>
        <ChainSwitcher selected={chain} onSelect={setChain} />
        <WalletPill
          chain={chain}
          evmAddress={evmAddress}
          solAddress={sol.address}
          onConnectEvm={() => openConnectModal?.()}
          onConnectSol={() => sol.connect()}
          onDisconnectEvm={() => disconnectEvm()}
          onDisconnectSol={() => sol.disconnect()}
        />
      </header>

      <main>
        {view === "album" ? (
          <AlbumView
            album={CRYPTO_RICH_DELUXE}
            chain={chain}
            walletAddress={activeWallet}
            onRequestConnect={requestConnect}
            playingTrackId={playingTrack?.id ?? null}
            isPlaying={isPlaying}
            onTogglePlay={toggleTrack}
          />
        ) : (
          <MultichainOverview album={CRYPTO_RICH_DELUXE} />
        )}
      </main>

      {view === "dashboard" && playingTrack && (
        <MiniPlayer
          track={playingTrack}
          isPlaying={isPlaying}
          onToggle={() => toggleTrack(playingTrack)}
          onClose={closePlayer}
        />
      )}
    </div>
  );
}
