"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Album, ALBUMS, CHAINS, ChainKey } from "@/lib/albums";
import ConsolePanel from "./ConsolePanel";
import BioSection from "./BioSection";
import MiniPlayer from "./MiniPlayer";
import StartMenu from "./StartMenu";
import GlobalTaskbar from "./GlobalTaskbar";
import WalletPill from "./WalletPill";
import { usePlayer } from "./PlayerContext";

export default function Landing({
  chain,
  onSelectChain,
  onConnect,
  album,
  walletAddress = null,
  evmAddress = null,
  solAddress = null,
  onConnectEvm,
  onConnectSol,
  onDisconnectEvm,
  onDisconnectSol,
}: {
  chain: ChainKey;
  onSelectChain: (chain: ChainKey) => void;
  onConnect: () => void;
  album: Album;
  walletAddress?: string | null;
  evmAddress?: string | null;
  solAddress?: string | null;
  onConnectEvm?: () => void;
  onConnectSol?: () => void;
  onDisconnectEvm?: () => void;
  onDisconnectSol?: () => void;
}) {
  const router = useRouter();
  const activeChain = CHAINS.find((c) => c.key === chain)!;
  const titleTrack = album.tracks[album.tracks.length - 1];
  const player = usePlayer();

  const [startOpen, setStartOpen] = useState(false);

  // Start is fixed-position so the menu itself is always visible regardless
  // of scroll, but a user who scrolled deep into the bio section before
  // opening it had no way back up short of scrolling manually past
  // everything again — scrolling to top on open (not on close) removes
  // that dead end entirely.
  function handleStartClick() {
    setStartOpen((open) => {
      const next = !open;
      if (next) window.scrollTo({ top: 0, behavior: "smooth" });
      return next;
    });
  }

  // Buy/sell actions still need a REAL wallet-connect prompt — distinct
  // from the hero button, which just takes you into the app with no
  // wallet required at all.
  function requestConnect() {
    if (chain === "solana") onConnectSol?.();
    else onConnectEvm?.();
  }

  return (
    <div className="landing-page" style={{ "--accent": activeChain.color } as React.CSSProperties}>
      <div className="landing-wallet-corner">
        <WalletPill
          chain={chain}
          evmAddress={evmAddress}
          solAddress={solAddress}
          onConnectEvm={() => onConnectEvm?.()}
          onConnectSol={() => onConnectSol?.()}
          onDisconnectEvm={() => onDisconnectEvm?.()}
          onDisconnectSol={() => onDisconnectSol?.()}
        />
      </div>

      <div className="landing">
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

            <h1>Every mint starts at $0.99</h1>

            <div className="landing-price">Buy with any coin from any chain</div>
            <div className="landing-price landing-price-last">Only 100 NFTs per song on each chain</div>

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
                    {c.shortLabel}
                  </button>
                ))}
              </div>
            </div>

            <button className="btn-connect" onClick={onConnect}>
              Enter App
            </button>

            <div className="aim-mini-window">
              <div className="aim-mini-titlebar">
                <span className="aim-titlebar-dot" />
                Chat
              </div>
              <div className="aim-mini-body">
                <button className="aim-msg" onClick={() => router.push("/about")}>
                  <Image
                    src="/brand/dyl-pfp.png"
                    alt="Dyl"
                    width={32}
                    height={32}
                    className="aim-msg-avatar"
                  />
                  <span className="aim-msg-body">
                    <span className="aim-msg-name">
                      Dyl <span className="aim-msg-dot" />
                    </span>
                    <span className="aim-msg-text">
                      no more relying on garbage platforms...i built this myself
                    </span>
                  </span>
                </button>

                <button className="aim-msg" onClick={() => router.push("/burn")}>
                  <Image
                    src="/brand/dyl-pfp.png"
                    alt="Dyl"
                    width={32}
                    height={32}
                    className="aim-msg-avatar"
                  />
                  <span className="aim-msg-body">
                    <span className="aim-msg-name">
                      Dyl <span className="aim-msg-dot" />
                    </span>
                    <span className="aim-msg-text">
                      if you had any of my old NFTs or $Dyl coin, burn them and get free mints
                    </span>
                  </span>
                </button>
              </div>
              <button className="aim-mini-reply" onClick={() => router.push("/chat")}>
                <span className="aim-mini-reply-input">Message Dyl…</span>
                <span className="aim-mini-reply-send">Send</span>
              </button>
            </div>

            <button className="btn-burn-hero" onClick={() => router.push("/burn")}>
              Burn Old NFTs &amp; $Dyl Coin
            </button>
          </div>

          <div className="landing-art">
            <ConsolePanel
              albums={ALBUMS}
              previewPlaying={player.isPlaying && player.playingTrack?.id === titleTrack.id}
              previewTitle={titleTrack.title}
              onTogglePreview={() => player.toggleTrack(titleTrack)}
            />
          </div>
        </div>
      </div>

      <BioSection />

      <GlobalTaskbar onStartClick={handleStartClick} />

      {startOpen && (
        <StartMenu
          allTracks={album.tracks}
          chain={chain}
          walletAddress={walletAddress}
          onRequestConnect={requestConnect}
          playingTrackId={player.playingTrack?.id ?? null}
          isPlaying={player.isPlaying}
          onTogglePlay={player.toggleTrack}
          onClose={() => setStartOpen(false)}
        />
      )}

      {player.playingTrack && (
        <MiniPlayer
          track={player.playingTrack}
          chain={chain}
          walletAddress={walletAddress}
          isPlaying={player.isPlaying}
          currentTime={player.currentTime}
          duration={player.duration}
          canGoPrev={player.canGoPrev}
          onToggle={() => player.toggleTrack(player.playingTrack!)}
          onClose={player.closePlayer}
          onRequestConnect={requestConnect}
          onSeek={player.seek}
          onPrev={player.playPrev}
          onNext={player.playNext}
        />
      )}
    </div>
  );
}
