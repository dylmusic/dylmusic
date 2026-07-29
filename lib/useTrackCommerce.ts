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
import type { PayStep } from "./payWithAnyToken";

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
// confirmation (pendingBuy) defaulting to the chain's native currency, then
// the "🚧 Not live yet" gate in BuyConfirmModal.tsx fires before anything
// below here is ever reached (real contracts aren't deployed yet). This
// cosmetic 1/2 -> 2/2 delay is what WOULD run if that gate weren't there —
// kept simple/unreachable on purpose rather than wired to the real
// lib/payWithAnyToken.ts engine, since nothing here can currently complete
// with a real NFT anyway. `buyStep`'s shape already matches the real
// engine's PayStep ({part,total,label}) so swapping this out later is just
// replacing the body of confirmPendingBuy, not the type it exposes.
export function useTrackCommerce(tracks: Track[], chain: ChainKey, walletAddress: string | null) {
  const [tick, setTick] = useState(0);
  const [busyKey, setBusyKey] = useState<string | null>(null); // `${trackId}:${entryKey}`
  const [pendingBuy, setPendingBuy] = useState<PendingBuy | null>(null);
  const [buyStep, setBuyStep] = useState<PayStep>(null);

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
      setBuyStep({ part: 1, total: 2, label: `Swapping ${payToken.symbol} to ${getNativeTokenForChain(chain).symbol}` });
      await delay(900);
      setBuyStep({ part: 2, total: 2, label: "Confirm purchase" });
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
