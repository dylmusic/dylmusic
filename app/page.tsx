"use client";

import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { CRYPTO_RICH_DELUXE } from "@/lib/albums";
import { useSolanaWallet } from "@/lib/solana";
import { usePersistedChain } from "@/lib/useChain";
import Landing from "@/components/Landing";

export default function Home() {
  const router = useRouter();
  const [chain, setChain] = usePersistedChain();

  const { address: evmAddress } = useAccount();
  const { openConnectModal } = useConnectModal();
  const sol = useSolanaWallet();

  const connected = !!evmAddress || !!sol.address;
  const activeWallet = chain === "solana" ? sol.address : evmAddress ?? null;

  function handleConnect() {
    if (connected) {
      router.push("/music");
      return;
    }
    if (chain === "solana") sol.connect();
    else openConnectModal?.();
  }

  return (
    <Landing
      chain={chain}
      onSelectChain={setChain}
      onConnect={handleConnect}
      alreadyConnected={connected}
      walletAddress={activeWallet}
      album={CRYPTO_RICH_DELUXE}
    />
  );
}
