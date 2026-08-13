"use client";

import { useEffect, useState } from "react";
import { ChainKey } from "./albums";
import { CONTRACT_TARGETS } from "./admin";
import { fetchRealOwnedTokenIds } from "./realOrderBook";

function isRealDeployed(chain: ChainKey): boolean {
  return !!CONTRACT_TARGETS.find((t) => t.key === chain)?.address;
}

// Real "does this wallet own at least one edition" check — chat.tsx and
// GlobalChatWidget.tsx both gated posting access on holdings.ts's simulated
// ownsAnyEdition() with no real/simulated switch at all, same class of bug
// as MusicGrid.tsx's owned-count and useTrackCommerce.ts's listings map
// (both fixed alongside this). A real buyer's genuine on-chain purchase
// was invisible to it; only each call site's `isAdmin ||` bypass masked
// this during testing, since the admin wallet always passes regardless.
// A chain with no deployed contract has no real owners at all — real
// false, not simulated data (Dylan, live: "remove simulated data for
// Base, SOL, ETH, move it to the real info which is zero").
export function useOwnsAnyEdition(chain: ChainKey, wallet: string | null, allTrackIds: string[]): boolean {
  const [owns, setOwns] = useState(false);

  useEffect(() => {
    if (!wallet || !isRealDeployed(chain) || chain === "solana") {
      setOwns(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const tokenIds = await fetchRealOwnedTokenIds(chain, wallet);
      if (!cancelled) setOwns(tokenIds.length > 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [chain, wallet, allTrackIds]);

  return owns;
}
