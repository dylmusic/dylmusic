"use client";

import { useRouter } from "next/navigation";
import { useAccount, useDisconnect } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { CRYPTO_RICH_DELUXE } from "@/lib/albums";
import { useSolanaWallet } from "@/lib/solana";
import { usePersistedChain } from "@/lib/useChain";
import Landing from "@/components/Landing";

export default function Home() {
  const router = useRouter();
  const [chain, setChain] = usePersistedChain();

  const { address: evmAddress } = useAccount();
  const { disconnect: disconnectEvm } = useDisconnect();
  const { openConnectModal } = useConnectModal();
  const sol = useSolanaWallet();

  const activeWallet = chain === "solana" ? sol.address : evmAddress ?? null;

  // Browsing never requires a wallet — this just takes you in. Connecting
  // is a separate, optional action via the pill in the top right.
  function handleEnter() {
    router.push("/music");
  }

  return (
    <Landing
      chain={chain}
      onSelectChain={setChain}
      onConnect={handleEnter}
      walletAddress={activeWallet}
      album={CRYPTO_RICH_DELUXE}
      evmAddress={evmAddress}
      solAddress={sol.address}
      onConnectEvm={() => openConnectModal?.()}
      onConnectSol={() => sol.connect()}
      onDisconnectEvm={() => disconnectEvm()}
      onDisconnectSol={() => sol.disconnect()}
    />
  );
}
