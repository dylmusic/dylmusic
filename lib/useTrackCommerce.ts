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

  async function mintTrack(t: Track) {
    if (!walletAddress) return;
    const current = baselineMinted(t, chain) + localMintedCount(chain, t.id);
    if (current < t.editionCap) {
      recordMint(chain, walletAddress, t.id, current + 1);
      recordActivity({
        type: "buy",
        chain,
        wallet: walletAddress,
        trackTitle: t.title,
        editionNumber: current + 1,
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
    setPendingBuy({ track: t, entry: floor });
  }

  function requestBuyFromBook(t: Track, entry: OrderBookEntry, onRequestConnect?: () => void) {
    if (!walletAddress) {
      onRequestConnect?.();
      return;
    }
    if (busyKey || pendingBuy) return;
    setPendingBuy({ track: t, entry });
  }

  function cancelPendingBuy() {
    if (busyKey) return; // don't yank the modal mid-animation
    setPendingBuy(null);
  }

  async function confirmPendingBuy(payToken: DylToken) {
    if (!pendingBuy || !walletAddress) return;
    const { track: t, entry } = pendingBuy;
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
    if (entry.type === "mint") await mintTrack(t);
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
