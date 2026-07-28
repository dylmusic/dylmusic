"use client";

import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useAccount, useDisconnect } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { CHAINS } from "@/lib/albums";
import { useSolanaWallet } from "@/lib/solana";
import { usePersistedChain } from "@/lib/useChain";
import { usePlayer } from "@/components/PlayerContext";
import { AppShellContext } from "@/components/AppShellContext";
import ChainSwitcher from "@/components/ChainSwitcher";
import WalletPill from "@/components/WalletPill";
import NicknameEditor from "@/components/NicknameEditor";
import MiniPlayer from "@/components/MiniPlayer";
import GlobalTaskbar from "@/components/GlobalTaskbar";
import Win95Window from "@/components/Win95Window";

function AppShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [chain, setChain] = usePersistedChain();

  const { address: evmAddress } = useAccount();
  const { disconnect: disconnectEvm } = useDisconnect();
  const { openConnectModal } = useConnectModal();
  const sol = useSolanaWallet();

  const activeWallet = chain === "solana" ? sol.address : evmAddress ?? null;

  function requestConnect() {
    if (chain === "solana") sol.connect();
    else openConnectModal?.();
  }

  const player = usePlayer();
  const onMusic = pathname === "/music" || pathname.startsWith("/music/");
  const onDashboard = pathname === "/dashboard";
  const onChat = pathname === "/chat";
  const onSwap = pathname === "/swap";
  const onBeats = pathname === "/beats";
  const onBurn = pathname === "/burn";
  const onBoard = pathname === "/board";
  const onAbout = pathname === "/about";
  const onPrint = pathname === "/print";
  const accentColor = CHAINS.find((c) => c.key === chain)?.color ?? "#CCFF00";

  const pageTitle = onMusic
    ? "Music"
    : onDashboard
    ? "Dashboard"
    : onSwap
    ? "Dyl Swap"
    : onBeats
    ? "Beats"
    : onBurn
    ? "Burn"
    : onBoard
    ? "Board"
    : onPrint
    ? "SYSTEM_ALERT.exe"
    : onAbout
    ? "About"
    : onChat
    ? "Chat"
    : "Dyl";

  return (
    <div className="app-shell" style={{ "--accent": accentColor } as React.CSSProperties}>
      <header className="app-header">
        <div className="app-header-left">
          <button className="app-logo-btn" onClick={() => router.push("/")} aria-label="Back to home">
            <Image
              src="/brand/dyl-logo-white.png"
              alt="Dyl"
              width={40}
              height={32}
              className="app-logo-img"
            />
          </button>
        </div>
        <ChainSwitcher selected={chain} onSelect={setChain} />
        <div className="wallet-pill-group">
          {activeWallet && <NicknameEditor wallet={activeWallet} />}
          <WalletPill
            chain={chain}
            evmAddress={evmAddress}
            solAddress={sol.address}
            onConnectEvm={() => openConnectModal?.()}
            onConnectSol={() => sol.connect()}
            onDisconnectEvm={() => disconnectEvm()}
            onDisconnectSol={() => sol.disconnect()}
          />
        </div>
      </header>

      <main>
        <AppShellContext.Provider value={{ chain, walletAddress: activeWallet, requestConnect }}>
          {onChat ? (
            children
          ) : (
            <Win95Window title={pageTitle} onClose={() => router.push("/")}>
              {children}
            </Win95Window>
          )}
        </AppShellContext.Provider>
      </main>

      <GlobalTaskbar />

      {player.playingTrack && (
        <MiniPlayer
          track={player.playingTrack}
          chain={chain}
          walletAddress={activeWallet}
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

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShellInner>{children}</AppShellInner>;
}
