"use client";

import Image from "next/image";
import { useState } from "react";
import type { Address } from "viem";
import { Album, ChainKey, Track, baselineMinted } from "@/lib/albums";
import { localMintedCount, recordMint } from "@/lib/holdings";
import { recordActivity } from "@/lib/activity";
import { useStreamCountsLoaded } from "@/lib/streams";
import { useTrackCommerce } from "@/lib/useTrackCommerce";
import type { DylToken } from "@/lib/dylTokens";
import { chainIdForKey } from "@/lib/dylTokens";
import { runPayWithAnyToken, isNativePayToken, type PayStep } from "@/lib/payWithAnyToken";
import { adaptDylEvmWallet } from "@/lib/dylSwap";
import { fulfillAlbumMintPurchase } from "@/lib/nftPurchase";
import { CONTRACT_TARGETS } from "@/lib/admin";
import TrackRow from "./TrackRow";
import ListingsModal from "./ListingsModal";
import OrderBookModal from "./OrderBookModal";
import BuyConfirmModal from "./BuyConfirmModal";
import MintSuccessModal from "./MintSuccessModal";

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

export default function AlbumView({
  album,
  chain,
  walletAddress,
  onRequestConnect,
  playingTrackId,
  isPlaying,
  onTogglePlay,
  onBack,
}: {
  album: Album;
  chain: ChainKey;
  walletAddress: string | null;
  onRequestConnect: () => void;
  playingTrackId: string | null;
  isPlaying: boolean;
  onTogglePlay: (track: Track, queue?: Track[]) => void;
  onBack?: () => void;
}) {
  const [sweepBusy, setSweepBusy] = useState(false);
  const [modalTrackId, setModalTrackId] = useState<string | null>(null);
  const [bookTrackId, setBookTrackId] = useState<string | null>(null);
  const [albumBuyOpen, setAlbumBuyOpen] = useState(false);
  const [albumBuyStep, setAlbumBuyStep] = useState<PayStep>(null);
  const [albumBuyError, setAlbumBuyError] = useState<string | null>(null);

  useStreamCountsLoaded();
  const commerce = useTrackCommerce(album.tracks, chain, walletAddress);
  const { minted, ownedEditions, listings, books } = commerce;
  const albumContractTarget = CONTRACT_TARGETS.find((t) => t.key === chain);

  // Buyable = still has supply left, regardless of whether the wallet
  // already owns one — completing the album used to hard-disable this
  // button ("Album complete"), which meant there was no way to buy a
  // second full run once you'd bought one of everything. Dylan: "yes,
  // indicate that [complete], but allow them to buy it again - duh." The
  // ★ Collected badge below still shows the complete state; the button
  // itself is only ever disabled by a REAL sellout (every track at cap).
  // `minted[t.id]` is undefined until the real fetch resolves — treating
  // that as 0 (not sold at all yet) instead of excluding the track keeps
  // "Buy Album" clickable immediately rather than reading as sold out
  // while data loads (same fix as useTrackCommerce's `books` fallback).
  const sweepTracks = album.tracks.filter((t) => (minted[t.id] ?? 0) < t.editionCap);
  const sweepTotal = sweepTracks.reduce((sum, t) => sum + t.priceUsd, 0);

  const totalMinted = album.tracks.reduce((sum, t) => sum + minted[t.id], 0);
  const totalCap = album.tracks.reduce((sum, t) => sum + t.editionCap, 0);
  const soldPct = Math.round((totalMinted / totalCap) * 100);

  // Buying the whole album now goes through the same Pay-With confirm
  // modal a single track uses (Dylan: "it still needs the buy button
  // popup interface... that's going to execute a multi-buy for all 19
  // items at once") — one confirmation, one optional swap-then-buy
  // animation if paying with a non-native token, then every track mints
  // in sequence underneath. See the `album` prop comment in
  // BuyConfirmModal.tsx for the real contract-shape implication this has
  // (not the same batch primitive as a single track's ERC721A
  // mint(quantity) — 19 different tokenId ranges, not one).
  function requestBuyAlbum() {
    if (!walletAddress) {
      onRequestConnect();
      return;
    }
    if (sweepBusy || sweepTracks.length === 0) return;
    setAlbumBuyOpen(true);
  }

  async function confirmBuyAlbum(payToken: DylToken) {
    if (!walletAddress) return;
    setSweepBusy(true);
    setAlbumBuyError(null);
    try {
      if (commerce.deployed && albumContractTarget?.albumBuyerAddress) {
        if (!isNativePayToken(payToken, chain)) {
          const result = await runPayWithAnyToken({
            payToken,
            targetChain: chain,
            totalUsd: sweepTotal,
            onStep: setAlbumBuyStep,
            ensureEvmChain: commerce.ensureEvmChain,
            adaptEvm: adaptDylEvmWallet,
            getSolanaWallet: commerce.getSolanaWalletForPay,
            evmAddress: commerce.evmAddress ?? null,
          });
          if (!result.ok) throw new Error("Swap did not complete — try again.");
        } else {
          setAlbumBuyStep({ part: 1, total: 1, label: "Confirm purchase" });
        }
        const freshClient = await commerce.ensureEvmChain(chainIdForKey(chain));
        await fulfillAlbumMintPurchase({
          chain,
          trackIds: sweepTracks.map((t) => t.index),
          quantities: sweepTracks.map(() => 1),
          buyerAddress: walletAddress as Address,
          walletClient: freshClient,
        });
        // Real reporting for the dashboard's global "Recent Transactions"/
        // sales stats — was missing entirely for the real album-buy path
        // (only the simulated branch below ever recorded anything, and
        // only into the buyer's own localStorage). One entry per track,
        // same granularity the simulated branch already uses. Best-effort,
        // fire-and-forget — the real mints already succeeded regardless.
        for (const t of sweepTracks) {
          fetch("/api/activity", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "buy", chain, wallet: walletAddress, trackTitle: t.title, editionNumber: null, priceUsd: t.priceUsd }),
          }).catch(() => {});
        }
      } else {
        const isNative =
          payToken.chainId === commerce.defaultPayToken.chainId &&
          payToken.address === commerce.defaultPayToken.address;
        if (!isNative) {
          setAlbumBuyStep({ part: 1, total: 2, label: `Swapping ${payToken.symbol} to ${commerce.defaultPayToken.symbol}` });
          await delay(900);
          setAlbumBuyStep({ part: 2, total: 2, label: "Confirm purchase" });
          await delay(900);
        } else {
          await delay(450);
        }
        for (const t of sweepTracks) {
          await delay(180);
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
      }
      commerce.setMintSuccess({
        trackTitle: album.title,
        editionNumber: null,
        priceUsd: sweepTotal,
        trackCount: sweepTracks.length,
      });
    } catch (err) {
      setAlbumBuyError(err instanceof Error ? err.message : "Purchase failed — see console.");
      console.error("confirmBuyAlbum failed", err);
      setSweepBusy(false);
      setAlbumBuyStep(null);
      return;
    }
    setSweepBusy(false);
    setAlbumBuyStep(null);
    setAlbumBuyOpen(false);
    commerce.refresh();
  }

  const totalEditionsOwned = album.tracks.reduce(
    (sum, t) => sum + (ownedEditions[t.id]?.length ?? 0),
    0
  );
  const fullyCollected =
    album.tracks.length > 0 && album.tracks.every((t) => (ownedEditions[t.id]?.length ?? 0) > 0);

  const modalTrack = modalTrackId ? album.tracks.find((t) => t.id === modalTrackId)! : null;
  const modalEditions = modalTrack
    ? (ownedEditions[modalTrack.id] ?? []).map((editionNumber) => ({
        editionNumber,
        listedPrice: listings[modalTrack.id]?.[editionNumber] ?? null,
      }))
    : [];

  const bookTrack = bookTrackId ? album.tracks.find((t) => t.id === bookTrackId)! : null;

  return (
    <div className="album-wrap">
      {onBack && (
        <button className="album-back" onClick={onBack}>
          ← Music
        </button>
      )}

      <div className="album-header">
        <div className="album-cover">
          <Image
            src={album.coverImage}
            alt={album.title}
            fill
            sizes="(max-width: 640px) 220px, 220px"
            priority
            style={{ objectFit: "cover" }}
          />
        </div>

        <div className="album-meta">
          <div className="album-eyebrow">Album · {album.year}</div>
          <h1>
            {album.title}
            {fullyCollected && <span className="music-card-collected album-collected">★ Collected</span>}
          </h1>
          <div className="album-artist-row">
            <div className="album-artist">{album.artist}</div>
            <a
              className="spotify-link"
              href="https://dylmusic.com/crypto-rich-deluxe"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="spotify-dot" />
              Listen on Spotify
            </a>
          </div>

          <div className="album-stats">
            <div>
              <span className="stat-num">{album.tracks.length}</span>
              <span className="stat-label">tracks</span>
            </div>
            <div>
              <span className="stat-num">{totalEditionsOwned}</span>
              <span className="stat-label">editions you own</span>
            </div>
            <div>
              <span className="stat-num">{soldPct}%</span>
              <span className="stat-label">sold ({chain})</span>
            </div>
          </div>

          <button
            className="btn-sweep"
            onClick={requestBuyAlbum}
            disabled={sweepBusy || sweepTracks.length === 0}
          >
            {sweepBusy
              ? "Buying album…"
              : sweepTracks.length === 0
              ? "Sold out"
              : `Buy Album · $${sweepTotal.toFixed(2)}`}
          </button>
        </div>
      </div>

      <div className="track-list">
        {album.tracks.map((t) => (
          <TrackRow
            key={t.id}
            track={t}
            minted={minted[t.id]}
            ownedEditions={ownedEditions[t.id] ?? []}
            listings={listings[t.id] ?? {}}
            book={books[t.id] ?? []}
            walletConnected={!!walletAddress}
            busy={commerce.busyKey?.startsWith(`${t.id}:`) ?? false}
            isPlaying={playingTrackId === t.id && isPlaying}
            isActive={playingTrackId === t.id}
            onTogglePlay={() => onTogglePlay(t, album.tracks)}
            onBuyFloor={() => commerce.requestBuyFloor(t, onRequestConnect)}
            onOpenOrderBook={() => setBookTrackId(t.id)}
            onConnect={onRequestConnect}
            onOpenSellModal={() => setModalTrackId(t.id)}
          />
        ))}
      </div>

      {modalTrack && (
        <ListingsModal
          track={modalTrack}
          editions={modalEditions}
          busy={commerce.sellBusy}
          error={commerce.sellError}
          onSetPrice={(editionNumber, price) => commerce.setEditionPrice(modalTrack, editionNumber, price)}
          onCancelListing={(editionNumber) => commerce.cancelEditionListing(modalTrack, editionNumber)}
          onClose={() => setModalTrackId(null)}
        />
      )}

      {bookTrack && (
        <OrderBookModal
          track={bookTrack}
          book={books[bookTrack.id] ?? []}
          busyKey={
            commerce.busyKey?.startsWith(`${bookTrack.id}:`) ? commerce.busyKey.split(":")[1] : null
          }
          onBuyMint={(qty) => {
            const mintEntry = books[bookTrack.id]?.find((e) => e.type === "mint");
            if (mintEntry) commerce.requestBuyFromBook(bookTrack, mintEntry, onRequestConnect, qty);
          }}
          onBuyResale={(entry) => commerce.requestBuyFromBook(bookTrack, entry, onRequestConnect)}
          onClose={() => setBookTrackId(null)}
        />
      )}

      {commerce.pendingBuy && (
        <BuyConfirmModal
          track={commerce.pendingBuy.track}
          entry={commerce.pendingBuy.entry}
          quantity={commerce.pendingBuy.quantity}
          defaultPayToken={commerce.defaultPayToken}
          buyStep={commerce.buyStep}
          busy={commerce.busyKey !== null}
          error={commerce.buyError}
          onConfirm={commerce.confirmPendingBuy}
          onCancel={commerce.cancelPendingBuy}
        />
      )}

      {albumBuyOpen && (
        <BuyConfirmModal
          quantity={1}
          album={{ title: album.title, trackCount: sweepTracks.length, totalUsd: sweepTotal }}
          defaultPayToken={commerce.defaultPayToken}
          buyStep={albumBuyStep}
          busy={sweepBusy}
          error={albumBuyError}
          onConfirm={confirmBuyAlbum}
          onCancel={() => {
            if (!sweepBusy) setAlbumBuyOpen(false);
          }}
        />
      )}

      {commerce.mintSuccess && (
        <MintSuccessModal info={commerce.mintSuccess} onClose={() => commerce.setMintSuccess(null)} />
      )}
    </div>
  );
}
