"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useWalletClient, useSwitchChain, ConnectorChainMismatchError } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import type { WalletClient, Address } from "viem";
import type { Listing } from "@opensea/sdk";
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
import { getNativeTokenForChain, chainIdForKey } from "./dylTokens";
import type { DylToken } from "./dylTokens";
import { runPayWithAnyToken, isNativePayToken, type PayStep } from "./payWithAnyToken";
import { adaptDylEvmWallet, adaptDylSolanaWallet } from "./dylSwap";
import { useSolanaWallet } from "./solana";
import { viemWalletClientToEthersSigner } from "./ethersSigner";
import { wagmiConfig } from "./web3";
import { CONTRACT_TARGETS } from "./admin";
import { fetchRealEvmListings, buildRealOrderBook, fetchRealMintRow, fetchRealOwnedTokenIds, type RealListing } from "./realOrderBook";
import { fulfillMintPurchase, fulfillResalePurchase, fulfillOpenSeaPurchase } from "./nftPurchase";
import { getOpenSeaSdk, isOpenSeaListable, createOpenSeaListings } from "./openSeaListing";
import { createSiteListings, cancelSiteListing, type StoredListing } from "./siteListing";
import { getTokenUsdPrice } from "./tokenUsdPrice";
import { encodeTokenId, decodeTokenId } from "./tokenIdScheme";
import {
  fetchRealSolanaListings,
  buildRealSolanaOrderBook,
  fetchRealSolanaMintRow,
  fetchMintRecords as fetchSolanaMintRecords,
  type RealSolanaListing,
} from "./realSolanaOrderBook";
import { fulfillSolanaMintPurchase, fulfillSolanaResalePurchase } from "./solanaPurchase";
import { getConnection } from "./solana";
import { filterOwnedMints } from "./solanaAdmin";
import { listEditionsOnMagicEden, cancelEditionsOnMagicEden } from "./magicEdenListing";
import type { SolanaMintRecord } from "./solanaMintsStore";

function isNativePayTokenLegacy(payToken: DylToken, nativeToken: DylToken): boolean {
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

// A chain is "real" here once its collection contract is actually
// deployed (lib/admin.ts CONTRACT_TARGETS) — every chain today, so every
// call site below falls back to the exact simulated behavior that existed
// before this real wiring, zero pre-launch regression. For Solana this
// means the Collection NFT exists — individual TRACKS may still have no
// Candy Machine yet (per-track, not one shared contract); those simply
// produce an empty real order book (no mint row, no listings) rather than
// falling back to simulated data, which is correct since they genuinely
// aren't purchasable yet either way.
function isRealDeployed(chain: ChainKey): boolean {
  return !!CONTRACT_TARGETS.find((t) => t.key === chain)?.address;
}

// Shared buy/sell/order-book logic — used anywhere a track needs full
// commerce functionality (AlbumView, MiniPlayer, the Start Menu's random
// picks) without re-deriving the same mint-vs-resale-floor math three times.
//
// Real buy/sell (2026-08-11): once a chain's collection contract is
// actually deployed, `books`/`minted` are sourced from real on-chain reads
// + real merged listings (our own site's Redis-backed Seaport orders AND
// OpenSea's own live order book — see lib/realOrderBook.ts), and
// `confirmPendingBuy` executes a real transaction instead of writing to
// localStorage. Every chain today has no deployed contract yet, so every
// consumer of this hook keeps behaving exactly as before until that
// changes — this is real, ready code, not yet reachable.
export function useTrackCommerce(tracks: Track[], chain: ChainKey, walletAddress: string | null) {
  const { address: evmAddress } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const sol = useSolanaWallet();

  const [tick, setTick] = useState(0);
  const [busyKey, setBusyKey] = useState<string | null>(null); // `${trackId}:${entryKey}`
  const [pendingBuy, setPendingBuy] = useState<PendingBuy | null>(null);
  const [buyStep, setBuyStep] = useState<PayStep>(null);
  const [buyError, setBuyError] = useState<string | null>(null);

  const deployed = isRealDeployed(chain);

  const [realListings, setRealListings] = useState<RealListing[]>([]);
  const [realBooks, setRealBooks] = useState<Record<string, OrderBookEntry[]>>({});
  const [realMinted, setRealMinted] = useState<Record<string, number>>({});
  const [realBooksLoading, setRealBooksLoading] = useState(false);
  const [solanaMintRecords, setSolanaMintRecords] = useState<SolanaMintRecord[]>([]);

  // Real order-book fetch — one merged sweep for the whole track list, not
  // per-track (fetchRealEvmListings/fetchRealSolanaListings are already
  // collection-scoped). Refetches on `tick` (the same refresh() every
  // mutating action below already calls) so a buy/sell is reflected
  // without a full page reload. EVM and Solana are different enough
  // (real Seaport/OpenSea orders vs. real Magic Eden listings + per-track
  // Candy Machines) that they get separate branches rather than one
  // forced-generic code path.
  useEffect(() => {
    if (!deployed) return;
    let cancelled = false;
    setRealBooksLoading(true);
    (async () => {
      if (chain === "solana") {
        const records = await fetchSolanaMintRecords();
        if (cancelled) return;
        setSolanaMintRecords(records);
        const listings = await fetchRealSolanaListings();
        if (cancelled) return;
        const nextBooks: Record<string, OrderBookEntry[]> = {};
        const nextMinted: Record<string, number> = {};
        for (const t of tracks) {
          nextBooks[t.id] = await buildRealSolanaOrderBook(t, records, listings);
          const mintRow = await fetchRealSolanaMintRow(t, records);
          nextMinted[t.id] = mintRow ? t.editionCap - mintRow.remaining : 0;
        }
        if (!cancelled) {
          setRealBooks(nextBooks);
          setRealMinted(nextMinted);
          setRealBooksLoading(false);
        }
        return;
      }

      let sdk = null;
      // A signer is required to construct OpenSeaSDK even for read-only
      // calls (no signer-less constructor exists) — until a wallet is
      // connected, real listings still work (our own site's), just without
      // the OpenSea half merged in yet.
      if (isOpenSeaListable(chain) && walletClient) {
        try {
          const signer = await viemWalletClientToEthersSigner(walletClient);
          sdk = getOpenSeaSdk(signer, chain);
        } catch {
          sdk = null;
        }
      }
      const listings = await fetchRealEvmListings(chain, sdk);
      if (cancelled) return;
      setRealListings(listings);

      const nextBooks: Record<string, OrderBookEntry[]> = {};
      const nextMinted: Record<string, number> = {};
      for (const t of tracks) {
        nextBooks[t.id] = await buildRealOrderBook(chain, t, listings);
        const mintRow = await fetchRealMintRow(chain, t);
        nextMinted[t.id] = mintRow ? t.editionCap - mintRow.remaining : 0;
      }
      if (!cancelled) {
        setRealBooks(nextBooks);
        setRealMinted(nextMinted);
        setRealBooksLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deployed, chain, tracks, walletClient, tick]);

  const [realOwnedEditions, setRealOwnedEditions] = useState<Record<string, number[]>>({});

  // Real on-chain ownership — ERC721AQueryableUpgradeable's tokensOfOwner
  // for EVM, a real per-mint Associated Token Account balance check
  // (filterOwnedMints, same call app/admin's "Reprice & Relist" already
  // uses, generalized to any wallet not just admin) for Solana — replaces
  // lib/holdings.ts's simulated per-wallet ledger once deployed.
  useEffect(() => {
    if (!deployed || !walletAddress) {
      setRealOwnedEditions({});
      return;
    }
    let cancelled = false;
    (async () => {
      if (chain === "solana") {
        const owned = await filterOwnedMints(getConnection(), solanaMintRecords, walletAddress);
        if (cancelled) return;
        const byTrack: Record<string, number[]> = {};
        for (const t of tracks) byTrack[t.id] = [];
        for (const r of owned) {
          const track = tracks.find((t) => t.index === r.trackId);
          if (track) byTrack[track.id].push(r.editionNumber);
        }
        if (!cancelled) setRealOwnedEditions(byTrack);
        return;
      }
      const tokenIds = await fetchRealOwnedTokenIds(chain, walletAddress);
      if (cancelled) return;
      const byTrack: Record<string, number[]> = {};
      for (const t of tracks) byTrack[t.id] = [];
      for (const tokenId of tokenIds) {
        const { trackId, editionNumber } = decodeTokenId(tokenId);
        const track = tracks.find((t) => t.index === trackId);
        if (track) byTrack[track.id].push(editionNumber);
      }
      if (!cancelled) setRealOwnedEditions(byTrack);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deployed, chain, tracks, walletAddress, tick, solanaMintRecords]);

  const simulatedMinted = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of tracks) m[t.id] = baselineMinted(t, chain) + localMintedCount(chain, t.id);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, chain, tick]);

  const simulatedOwnedEditions = useMemo(() => {
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

  const simulatedBooks = useMemo(() => {
    const b: Record<string, OrderBookEntry[]> = {};
    for (const t of tracks) b[t.id] = buildOrderBook(t, chain);
    return b;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, chain, tick]);

  const minted = deployed ? realMinted : simulatedMinted;
  const books = deployed ? realBooks : simulatedBooks;
  const ownedEditions = deployed ? realOwnedEditions : simulatedOwnedEditions;

  function refresh() {
    setTick((n) => n + 1);
  }

  // ---- Real-execution helpers, shared with AlbumView.tsx's whole-album
  // buy (a separate call site — batches across N tracks via AlbumBuyer,
  // genuinely different semantics from a single mint/resale purchase, but
  // needs the exact same chain-switching/wallet-adapting machinery). Same
  // proven switchChainAsync -> retry-on-ConnectorChainMismatchError shape
  // already used by /swap's own ensureEvmChain (components/SwapCard.tsx).

  async function ensureEvmChain(chainId: number): Promise<WalletClient> {
    await switchChainAsync({ chainId });
    for (let attempt = 0; ; attempt++) {
      try {
        return await getWalletClient(wagmiConfig, { chainId });
      } catch (e) {
        if (attempt >= 5 || !(e instanceof ConnectorChainMismatchError)) throw e;
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  }

  function getSolanaWalletForPay() {
    return {
      address: sol.address,
      adapt: () => {
        const provider = sol.getProvider();
        if (!sol.address || !provider) return null;
        return adaptDylSolanaWallet(sol.address, (tx, opts) => provider.signAndSendTransaction(tx, opts));
      },
    };
  }

  // Mints up to `quantity` sequential fresh editions in one go (clamped to
  // whatever's actually left) — the "mint 10 copies at once" case. Each
  // edition still gets its own recordMint/recordActivity call, same
  // granularity a real multi-mint transaction's individual Transfer events
  // would have; only the UI/confirmation step treats it as one action.
  async function mintTrackSimulated(t: Track, quantity = 1) {
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

  async function buyResaleEntrySimulated(t: Track, entry: OrderBookEntry) {
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
    // Solana mints are capped at 1 regardless of what the quantity stepper
    // asks for — fulfillSolanaMintPurchase only ever mints one NFT per
    // Candy Machine instruction (real Metaplex constraint, no batch-mint
    // equivalent to ERC721A's ceiling here), and the priced-swap step above
    // it in confirmPendingBuy now genuinely charges for `quantity` editions'
    // worth of SOL — letting quantity exceed 1 here would swap for N
    // editions' worth of SOL while only ever minting 1 NFT.
    const clamped =
      entry.type === "mint" ? (chain === "solana" ? 1 : Math.min(Math.max(1, quantity), entry.remaining ?? 1)) : 1;
    setPendingBuy({ track: t, entry, quantity: clamped });
  }

  function cancelPendingBuy() {
    if (busyKey) return; // don't yank the modal mid-animation
    setBuyError(null);
    setPendingBuy(null);
  }

  async function confirmPendingBuy(payToken: DylToken) {
    if (!pendingBuy || !walletAddress) return;
    const { track: t, entry, quantity } = pendingBuy;
    const entryKey = entry.type === "mint" ? "mint" : `${entry.editionNumber}`;
    setBusyKey(`${t.id}:${entryKey}`);
    setBuyError(null);
    try {
      if (deployed && chain === "solana") {
        // Now wired to lib/payWithAnyToken.ts the same way the EVM branch
        // below already is — runPayWithAnyToken was always chain-agnostic
        // (it already branches on targetIsSolana throughout: recipient
        // address, native-balance reads, bridge-wait), so this was a
        // wiring gap, not a missing engine. Any non-SOL payToken swaps to
        // SOL first (same-chain 2-step, or cross-chain 3-step with a live
        // bridge-wait counter); a SOL payToken skips straight to the mint,
        // same as the EVM branch's native-pay-token case.
        const provider = sol.getProvider();
        if (!sol.address || !provider) throw new Error("Connect Phantom first.");
        if (!isNativePayToken(payToken, "solana")) {
          const result = await runPayWithAnyToken({
            payToken,
            targetChain: "solana",
            totalUsd: entry.priceUsd * quantity,
            onStep: setBuyStep,
            ensureEvmChain,
            adaptEvm: adaptDylEvmWallet,
            getSolanaWallet: getSolanaWalletForPay,
            evmAddress: evmAddress ?? null,
          });
          if (!result.ok) throw new Error("Swap did not complete — try again.");
        } else {
          setBuyStep({ part: 1, total: 1, label: "Confirm purchase" });
        }
        if (entry.type === "mint") {
          const record = solanaMintRecords.find((r) => r.trackId === t.index);
          if (!record?.candyGuard) throw new Error("This track's Solana mint isn't set up yet.");
          const result = await fulfillSolanaMintPurchase({ provider, candyMachine: record.candyMachine, candyGuard: record.candyGuard });
          // Record the fresh mint so it can be found/resold later (Magic
          // Eden has no concept of our own trackId/editionNumber numbering
          // — without this, a real public mint would be untrackable by
          // our own "List for sale" flow). Best-effort: the real on-chain
          // mint already succeeded regardless of whether this write does.
          await fetch("/api/solana-mints", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              wallet: sol.address,
              mints: [
                {
                  trackId: result.trackId,
                  editionNumber: result.editionNumber,
                  tokenId: result.tokenId,
                  mint: result.mint,
                  candyMachine: record.candyMachine,
                  candyGuard: record.candyGuard,
                },
              ],
            }),
          }).catch(() => {});
        } else {
          const listing = entry.raw as RealSolanaListing;
          await fulfillSolanaResalePurchase({
            provider,
            connection: getConnection(),
            buyerAddress: sol.address,
            listing: { buyer: sol.address, seller: listing.sellerAddress, tokenMint: listing.mint, priceSol: listing.priceSol, sellerExpiry: listing.expiry },
          });
        }
      } else if (deployed) {
        const chainId = chainIdForKey(chain);
        if (!isNativePayToken(payToken, chain)) {
          const result = await runPayWithAnyToken({
            payToken,
            targetChain: chain,
            totalUsd: entry.priceUsd * quantity,
            onStep: setBuyStep,
            ensureEvmChain,
            adaptEvm: adaptDylEvmWallet,
            getSolanaWallet: getSolanaWalletForPay,
            evmAddress: evmAddress ?? null,
          });
          if (!result.ok) throw new Error("Swap did not complete — try again.");
        } else {
          setBuyStep({ part: 1, total: 1, label: "Confirm purchase" });
        }

        const freshClient = await ensureEvmChain(chainId);
        if (entry.type === "mint") {
          await fulfillMintPurchase({
            chain,
            trackId: t.index,
            quantity,
            buyerAddress: walletAddress as Address,
            walletClient: freshClient,
          });
        } else if (entry.source === "opensea" && entry.raw) {
          await fulfillOpenSeaPurchase({
            chain,
            listing: entry.raw as Listing,
            buyerAddress: walletAddress as Address,
            walletClient: freshClient,
          });
        } else {
          await fulfillResalePurchase({
            chain,
            trackId: t.index,
            editionNumber: entry.editionNumber!,
            buyerAddress: walletAddress as Address,
            walletClient: freshClient,
          });
          if (entry.chainId && entry.tokenId !== undefined) {
            await fetch("/api/listings", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chainId: entry.chainId, tokenId: entry.tokenId }),
            }).catch(() => {}); // best-effort cache cleanup — the real sale already happened on-chain regardless
          }
        }
      } else {
        if (!isNativePayTokenLegacy(payToken, getNativeTokenForChain(chain))) {
          setBuyStep({ part: 1, total: 2, label: `Swapping ${payToken.symbol} to ${getNativeTokenForChain(chain).symbol}` });
          await delay(900);
          setBuyStep({ part: 2, total: 2, label: "Confirm purchase" });
          await delay(900);
        } else {
          await delay(450);
        }
        if (entry.type === "mint") await mintTrackSimulated(t, quantity);
        else await buyResaleEntrySimulated(t, entry);
      }
    } catch (err) {
      setBuyError(err instanceof Error ? err.message : "Purchase failed — see console.");
      console.error("confirmPendingBuy failed", err);
      return;
    } finally {
      setBusyKey(null);
      setBuyStep(null);
    }
    setPendingBuy(null);
    refresh();
  }

  const [sellBusy, setSellBusy] = useState(false);
  const [sellError, setSellError] = useState<string | null>(null);

  // Real "List for sale" — signs our own site's 0%-fee Seaport order AND
  // (per Dylan's confirmed scope) an OpenSea listing too, dual-listed same
  // as admin's own #1-10 editions. The OpenSea half is best-effort: a
  // missing NEXT_PUBLIC_OPENSEA_API_KEY or an unindexed brand-new
  // collection shouldn't fail a listing that otherwise succeeded on our
  // own site, so its own error is caught and swallowed (logged only).
  async function setEditionPriceReal(t: Track, editionNumber: number, price: number) {
    const target = CONTRACT_TARGETS.find((c) => c.key === chain);
    if (!walletAddress || !target?.address || !target.chainId) return;
    setSellBusy(true);
    setSellError(null);
    try {
      const nativeToken = getNativeTokenForChain(chain);
      const nativeUsd = await getTokenUsdPrice(nativeToken);
      if (!nativeUsd) throw new Error(`Could not price ${nativeToken.symbol} right now — try again shortly.`);
      const priceWei = BigInt(Math.round((price / nativeUsd) * 1e18));
      const tokenId = encodeTokenId(t.index, editionNumber);

      const freshClient = await ensureEvmChain(target.chainId);
      const signer = await viemWalletClientToEthersSigner(freshClient);

      const siteOrders = await createSiteListings(signer, [
        { collectionAddress: target.address, tokenId, priceWei, sellerAddress: walletAddress },
      ]);
      const listingsRes = await fetch("/api/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: walletAddress,
          listings: [
            {
              chainId: target.chainId,
              collectionAddress: target.address,
              tokenId,
              priceWei: priceWei.toString(),
              sellerAddress: walletAddress,
              parameters: siteOrders[0].parameters,
              signature: siteOrders[0].signature,
              createdAt: Date.now(),
            },
          ],
        }),
      });
      const listingsData = await listingsRes.json().catch(() => null);
      if (!listingsRes.ok || !listingsData?.ok) {
        throw new Error(`Listed on-chain but failed to save to the server (status ${listingsRes.status}) — try again.`);
      }

      if (isOpenSeaListable(chain)) {
        try {
          const sdk = getOpenSeaSdk(signer, chain);
          await createOpenSeaListings(sdk, [
            { collectionAddress: target.address, tokenId, priceWei, sellerAddress: walletAddress },
          ]);
        } catch (openSeaErr) {
          console.error("OpenSea dual-listing failed (site listing still succeeded):", openSeaErr);
        }
      }

      recordActivity({ type: "sell", chain, wallet: walletAddress, trackTitle: t.title, editionNumber, priceUsd: price });
      refresh();
    } catch (err) {
      setSellError(err instanceof Error ? err.message : "Listing failed — see console.");
      console.error("setEditionPriceReal failed", err);
    } finally {
      setSellBusy(false);
    }
  }

  function setEditionPriceSimulated(t: Track, editionNumber: number, price: number) {
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

  // Real Solana "List for sale" — Magic Eden only (no site-native listing
  // exists for Solana, same asymmetry already documented in CLAUDE.md).
  // Requires the edition to already have a SolanaMintRecord (an
  // admin-premint edition, or a fresh public mint the buy flow above just
  // recorded) — nothing to list otherwise, since Magic Eden needs the
  // real mint address, not just a track/edition number.
  async function setEditionPriceSolanaReal(t: Track, editionNumber: number, price: number) {
    const provider = sol.getProvider();
    if (!sol.address || !provider) return;
    const record = solanaMintRecords.find((r) => r.trackId === t.index && r.editionNumber === editionNumber);
    if (!record) {
      setSellError("This edition isn't recorded yet — try refreshing.");
      return;
    }
    setSellBusy(true);
    setSellError(null);
    try {
      const solToken = getNativeTokenForChain("solana");
      const solUsd = await getTokenUsdPrice(solToken);
      if (!solUsd) throw new Error("Could not price SOL right now — try again shortly.");
      const priceSol = price / solUsd;
      const result = await listEditionsOnMagicEden(provider, getConnection(), sol.address, [{ mint: record.mint, priceSol }]);
      if (result.failed.length > 0) throw result.failed[0].error;
      await fetch("/api/solana-mints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: sol.address, mints: [{ ...record, listedPriceSol: priceSol }] }),
      }).catch(() => {});
      recordActivity({ type: "sell", chain, wallet: sol.address, trackTitle: t.title, editionNumber, priceUsd: price });
      refresh();
    } catch (err) {
      setSellError(err instanceof Error ? err.message : "Listing failed — see console.");
      console.error("setEditionPriceSolanaReal failed", err);
    } finally {
      setSellBusy(false);
    }
  }

  function setEditionPrice(t: Track, editionNumber: number, price: number) {
    if (deployed && chain === "solana") void setEditionPriceSolanaReal(t, editionNumber, price);
    else if (deployed) void setEditionPriceReal(t, editionNumber, price);
    else setEditionPriceSimulated(t, editionNumber, price);
  }

  // Cancels ONE listing for real — Seaport-js's per-order cancel
  // (lib/siteListing.ts cancelSiteListing), not the admin-only bulk
  // cancelAllListings, so this never touches any other listing the same
  // wallet has. Known gap, documented on cancelSiteListing itself: an
  // OpenSea-side dual-listing for the same edition isn't cancelled by
  // this — it stays listed there until it naturally fails to fulfill or
  // expires.
  async function cancelEditionListingReal(t: Track, editionNumber: number) {
    const target = CONTRACT_TARGETS.find((c) => c.key === chain);
    if (!walletAddress || !target?.address || !target.chainId) return;
    const tokenId = encodeTokenId(t.index, editionNumber);
    const existing = realListings.find((l) => l.source === "site" && l.tokenId === tokenId);
    if (!existing) return; // nothing of ours to cancel (already sold, or was never a site listing)
    setSellBusy(true);
    setSellError(null);
    try {
      const freshClient = await ensureEvmChain(target.chainId);
      const signer = await viemWalletClientToEthersSigner(freshClient);
      await cancelSiteListing(signer, (existing.raw as StoredListing).parameters);
      await fetch("/api/listings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chainId: target.chainId, tokenId, wallet: walletAddress }),
      });
      refresh();
    } catch (err) {
      setSellError(err instanceof Error ? err.message : "Cancel failed — see console.");
      console.error("cancelEditionListingReal failed", err);
    } finally {
      setSellBusy(false);
    }
  }

  function cancelEditionListingSimulated(t: Track, editionNumber: number) {
    if (!walletAddress) return;
    setListingForEdition(chain, walletAddress, t.id, editionNumber, null);
    refresh();
  }

  /** Real Solana cancel — Magic Eden's own sell_cancel instruction, needs the listing's exact CURRENT price as an input (their Auction House model, not Seaport). */
  async function cancelEditionListingSolanaReal(t: Track, editionNumber: number) {
    const provider = sol.getProvider();
    if (!sol.address || !provider) return;
    const record = solanaMintRecords.find((r) => r.trackId === t.index && r.editionNumber === editionNumber);
    if (!record?.listedPriceSol) return; // nothing of ours to cancel (already sold, or was never listed)
    setSellBusy(true);
    setSellError(null);
    try {
      const result = await cancelEditionsOnMagicEden(provider, getConnection(), sol.address, [
        { mint: record.mint, priceSol: record.listedPriceSol },
      ]);
      if (result.failed.length > 0) throw result.failed[0].error;
      const { listedPriceSol: _drop, ...withoutPrice } = record;
      await fetch("/api/solana-mints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: sol.address, mints: [withoutPrice] }),
      }).catch(() => {});
      refresh();
    } catch (err) {
      setSellError(err instanceof Error ? err.message : "Cancel failed — see console.");
      console.error("cancelEditionListingSolanaReal failed", err);
    } finally {
      setSellBusy(false);
    }
  }

  function cancelEditionListing(t: Track, editionNumber: number) {
    if (deployed && chain === "solana") void cancelEditionListingSolanaReal(t, editionNumber);
    else if (deployed) void cancelEditionListingReal(t, editionNumber);
    else cancelEditionListingSimulated(t, editionNumber);
  }

  return {
    minted,
    ownedEditions,
    listings,
    books,
    busyKey,
    pendingBuy,
    buyStep,
    buyError,
    sellBusy,
    sellError,
    realBooksLoading,
    deployed,
    realListings,
    defaultPayToken: getNativeTokenForChain(chain),
    requestBuyFloor,
    requestBuyFromBook,
    confirmPendingBuy,
    cancelPendingBuy,
    setEditionPrice,
    cancelEditionListing,
    refresh,
    // Exposed so AlbumView.tsx's whole-album buy (a separate call site,
    // genuinely different batching semantics) can reuse the exact same
    // chain-switching/wallet-adapting machinery instead of duplicating it.
    ensureEvmChain,
    getSolanaWalletForPay,
    evmAddress,
  };
}
