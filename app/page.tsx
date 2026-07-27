"use client";

import Image from "next/image";
import { useState } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { ChainKey, CRYPTO_RICH_DELUXE } from "@/lib/albums";
import { useSolanaWallet } from "@/lib/solana";
import Landing from "@/components/Landing";
import ChainSwitcher from "@/components/ChainSwitcher";
import WalletPill from "@/components/WalletPill";
import AlbumView from "@/components/AlbumView";

export default function Home() {
  const [chain, setChain] = useState<ChainKey>("base");

  const { address: evmAddress } = useAccount();
  const { disconnect: disconnectEvm } = useDisconnect();
  const { openConnectModal } = useConnectModal();

  const sol = useSolanaWallet();

  const connected = !!evmAddress || !!sol.address;
  const activeWallet = chain === "solana" ? sol.address : evmAddress ?? null;

  function requestConnect() {
    if (chain === "solana") sol.connect();
    else openConnectModal?.();
  }

  if (!connected) {
    return <Landing chain={chain} onSelectChain={setChain} onConnect={requestConnect} />;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <Image
          src="/brand/dyl-logo-white.png"
          alt="dyl"
          width={40}
          height={32}
          className="app-logo-img"
        />
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
        <AlbumView
          album={CRYPTO_RICH_DELUXE}
          chain={chain}
          walletAddress={activeWallet}
          onRequestConnect={requestConnect}
        />
      </main>
    </div>
  );
}
