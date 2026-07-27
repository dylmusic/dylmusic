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

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

// Shared buy/sell/order-book logic — used anywhere a track needs full
// commerce functionality (AlbumView's track list, the Start Menu's random
// picks) without re-deriving the same mint-vs-resale-floor math twice.
export function useTrackCommerce(tracks: Track[], chain: ChainKey, walletAddress: string | null) {
  const [tick, setTick] = useState(0);
  const [busyKey, setBusyKey] = useState<string | null>(null); // `${trackId}:${entryKey}`

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

  async function buyFloor(t: Track, onRequestConnect?: () => void) {
    if (!walletAddress) {
      onRequestConnect?.();
      return;
    }
    if (busyKey) return;
    const floor = books[t.id]?.[0];
    if (!floor) return;
    setBusyKey(`${t.id}:${floor.type === "mint" ? "mint" : floor.editionNumber}`);
    await delay(450);
    if (floor.type === "mint") await mintTrack(t);
    else await buyResaleEntry(t, floor);
    setBusyKey(null);
    refresh();
  }

  async function buyFromBook(t: Track, entry: OrderBookEntry, onRequestConnect?: () => void) {
    if (!walletAddress) {
      onRequestConnect?.();
      return;
    }
    if (busyKey) return;
    setBusyKey(`${t.id}:${entry.type === "mint" ? "mint" : entry.editionNumber}`);
    await delay(450);
    if (entry.type === "mint") await mintTrack(t);
    else await buyResaleEntry(t, entry);
    setBusyKey(null);
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
    buyFloor,
    buyFromBook,
    setEditionPrice,
    cancelEditionListing,
    refresh,
  };
}
