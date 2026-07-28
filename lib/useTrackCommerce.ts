"use client";

import { useMemo, useState } from "react";
import { Track, ChainKey, baselineMinted } from "./albums";
import {
  getOwnedEditions,
  getListings,
  localMintedCount,
  recordMint,
  setListingForEdition,
  buyListedEdition,
} from "./holdings";
import { buildOrderBook, OrderBookEntry } from "./orderbook";
import { recordActivity } from "./activity";
import { getNativeTokenForChain } from "./dylTokens";
import type { DylToken } from "./dylTokens";

function isNativePayToken(payToken: DylToken, nativeToken: DylToken): boolean {
  return payToken.chainId === nativeToken.chainId && payToken.address === nativeToken.address;
}

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

export interface PendingBuy {
  track: Track;
  entry: OrderBookEntry;
  // Only meaningful for entry.type === "mint" — a resale entry is one
  // specific already-numbered edition, there's nothing to multiply.
  // Defaults to 1, clamped to entry.remaining when set.
  quantity: number;
}

// Shared buy/sell/order-book logic — used anywhere a track needs full
// commerce functionality (AlbumView, MiniPlayer, the Start Menu's random
// picks) without re-deriving the same mint-vs-resale-floor math three times.
//
// Clicking Buy no longer purchases instantly — it opens a "Pay With"
// confirmation (pendingBuy) defaulting to the chain's native currency.
// Nothing here is wired to a real payment yet (no NFTs are actually for
// sale), so a non-native currency choice just plays a cosmetic 1/2 -> 2/2
// "swap then buy" animation (buyStep) before the same simulated purchase
// that a native-currency buy already does — no real signing either way.
export function useTrackCommerce(tracks: Track[], chain: ChainKey, walletAddress: string | null) {
  const [tick, setTick] = useState(0);
  const [busyKey, setBusyKey] = useState<string | null>(null); // `${trackId}:${entryKey}`
  const [pendingBuy, setPendingBuy] = useState<PendingBuy | null>(null);
  const [buyStep, setBuyStep] = useState<1 | 2 | null>(null);

  const minted = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of tracks) m[t.id] = baselineMinted(t, chain) + localMintedCount(chain, t.id);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, chain, tick]);

  const ownedEditions = useMemo(() => {
    if (!walletAddress) return {};
    const h: Record<string, number[]> = {};
    for (const t of tracks) h[t.id] = getOwnedEditions(chain, walletAddress, t.id);
    return h;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, chain, walletAddress, tick]);

  const listings = useMemo(() => {
    if (!walletAddress) return {};
    const l: Record<string, Record<number, number>> = {};
    for (const t of tracks) l[t.id] = getListings(chain, walletAddress, t.id);
    return l;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, chain, walletAddress, tick]);

  const books = useMemo(() => {
    const b: Record<string, OrderBookEntry[]> = {};
    for (const t of tracks) b[t.id] = buildOrderBook(t, chain);
    return b;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, chain, tick]);

  function refresh() {
    setTick((n) => n + 1);
  }

  // Mints up to `quantity` sequential fresh editions in one go (clamped to
  // whatever's actually left) — the "mint 10 copies at once" case. Each
  // edition still gets its own recordMint/recordActivity call, same
  // granularity a real multi-mint transaction's individual Transfer events
  // would have; only the UI/confirmation step treats it as one action.
  async function mintTrack(t: Track, quantity = 1) {
    if (!walletAddress) return;
    let current = baselineMinted(t, chain) + localMintedCount(chain, t.id);
    const n = Math.max(1, Math.floor(quantity));
    for (let i = 0; i < n && current < t.editionCap; i++) {
      current += 1;
      recordMint(chain, walletAddress, t.id, current);
      recordActivity({
        type: "buy",
        chain,
        wallet: walletAddress,
        trackTitle: t.title,
        editionNumber: current,
        priceUsd: t.priceUsd,
      });
    }
  }

  async function buyResaleEntry(t: Track, entry: OrderBookEntry) {
    if (!walletAddress || entry.type !== "resale") return;
    buyListedEdition(chain, t.id, entry.seller!, walletAddress, entry.editionNumber!);
    recordActivity({
      type: "buy",
      chain,
      wallet: walletAddress,
      trackTitle: t.title,
      editionNumber: entry.editionNumber!,
      priceUsd: entry.priceUsd,
    });
  }

  function requestBuyFloor(t: Track, onRequestConnect?: () => void) {
    if (!walletAddress) {
      onRequestConnect?.();
      return;
    }
    if (busyKey || pendingBuy) return;
    const floor = books[t.id]?.[0];
    if (!floor) return;
    setPendingBuy({ track: t, entry: floor, quantity: 1 });
  }

  function requestBuyFromBook(
    t: Track,
    entry: OrderBookEntry,
    onRequestConnect?: () => void,
    quantity = 1
  ) {
    if (!walletAddress) {
      onRequestConnect?.();
      return;
    }
    if (busyKey || pendingBuy) return;
    const clamped =
      entry.type === "mint" ? Math.min(Math.max(1, quantity), entry.remaining ?? 1) : 1;
    setPendingBuy({ track: t, entry, quantity: clamped });
  }

  function cancelPendingBuy() {
    if (busyKey) return; // don't yank the modal mid-animation
    setPendingBuy(null);
  }

  async function confirmPendingBuy(payToken: DylToken) {
    if (!pendingBuy || !walletAddress) return;
    const { track: t, entry, quantity } = pendingBuy;
    const entryKey = entry.type === "mint" ? "mint" : `${entry.editionNumber}`;
    setBusyKey(`${t.id}:${entryKey}`);
    if (!isNativePayToken(payToken, getNativeTokenForChain(chain))) {
      setBuyStep(1);
      await delay(900);
      setBuyStep(2);
      await delay(900);
    } else {
      await delay(450);
    }
    if (entry.type === "mint") await mintTrack(t, quantity);
    else await buyResaleEntry(t, entry);
    setBusyKey(null);
    setBuyStep(null);
    setPendingBuy(null);
    refresh();
  }

  function setEditionPrice(t: Track, editionNumber: number, price: number) {
    if (!walletAddress) return;
    setListingForEdition(chain, walletAddress, t.id, editionNumber, price);
    recordActivity({
      type: "sell",
      chain,
      wallet: walletAddress,
      trackTitle: t.title,
      editionNumber,
      priceUsd: price,
    });
    refresh();
  }

  function cancelEditionListing(t: Track, editionNumber: number) {
    if (!walletAddress) return;
    setListingForEdition(chain, walletAddress, t.id, editionNumber, null);
    refresh();
  }

  return {
    minted,
    ownedEditions,
    listings,
    books,
    busyKey,
    pendingBuy,
    buyStep,
    defaultPayToken: getNativeTokenForChain(chain),
    requestBuyFloor,
    requestBuyFromBook,
    confirmPendingBuy,
    cancelPendingBuy,
    setEditionPrice,
    cancelEditionListing,
    refresh,
  };
}
