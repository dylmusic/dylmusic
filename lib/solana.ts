"use client";

import { useCallback, useEffect, useState } from "react";

// Lightweight direct-Phantom connect (window.solana), same "call the
// injected provider directly" pattern used for the EIP-1193 case elsewhere —
// avoids pulling in the full @solana/wallet-adapter stack for a first pass.
// Swap for the full adapter later if multi-Solana-wallet support matters.

interface PhantomProvider {
  isPhantom?: boolean;
  publicKey?: { toString(): string } | null;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString(): string } }>;
  disconnect: () => Promise<void>;
}

function getPhantom(): PhantomProvider | undefined {
  if (typeof window === "undefined") return undefined;
  const anyWindow = window as unknown as { solana?: PhantomProvider };
  return anyWindow.solana?.isPhantom ? anyWindow.solana : undefined;
}

export function useSolanaWallet() {
  const [address, setAddress] = useState<string | null>(null);

  useEffect(() => {
    const provider = getPhantom();
    if (provider?.publicKey) setAddress(provider.publicKey.toString());
  }, []);

  const connect = useCallback(async () => {
    const provider = getPhantom();
    if (!provider) {
      window.open("https://phantom.app/download", "_blank");
      return;
    }
    const res = await provider.connect();
    setAddress(res.publicKey.toString());
  }, []);

  const disconnect = useCallback(async () => {
    const provider = getPhantom();
    if (provider) await provider.disconnect();
    setAddress(null);
  }, []);

  return { address, connect, disconnect, hasPhantom: !!getPhantom() };
}
