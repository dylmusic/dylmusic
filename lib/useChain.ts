"use client";

import { useEffect, useState } from "react";
import { ChainKey } from "./albums";

const STORAGE_KEY = "dylmusic_chain_v1";

// Persisted in localStorage (not a shared React context) so the selection
// survives real page navigation between "/" and the app routes, and
// survives a refresh, without needing a root-level provider.
export function usePersistedChain(): [ChainKey, (c: ChainKey) => void] {
  const [chain, setChainState] = useState<ChainKey>("robinhood");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY) as ChainKey | null;
    if (saved === "robinhood" || saved === "base" || saved === "solana") {
      setChainState(saved);
    }
  }, []);

  function setChain(c: ChainKey) {
    setChainState(c);
    try {
      window.localStorage.setItem(STORAGE_KEY, c);
    } catch {
      // ignore
    }
  }

  return [chain, setChain];
}
