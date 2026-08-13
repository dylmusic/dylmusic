"use client";

import { useEffect, useState } from "react";
import { CHAINS, ChainKey } from "./albums";

const STORAGE_KEY = "dylmusic_chain_v1";

// Persisted in localStorage (not a shared React context) so the selection
// survives real page navigation between "/" and the app routes, and
// survives a refresh, without needing a root-level provider.
export function usePersistedChain(): [ChainKey, (c: ChainKey) => void] {
  const [chain, setChainState] = useState<ChainKey>("robinhood");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY) as ChainKey | null;
    // Only restore a saved chain if it's still `live` — otherwise a
    // selection persisted from before a chain was un-exposed (or one that
    // was never live) would silently stay active for buying with no way
    // to reach it via the picker to switch off of it.
    if (saved && CHAINS.find((c) => c.key === saved)?.live) {
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
