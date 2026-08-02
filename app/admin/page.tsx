"use client";

import { useEffect, useState } from "react";
import { useAccount, useSendTransaction, useSwitchChain } from "wagmi";
import { getWalletClient, getPublicClient } from "wagmi/actions";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { ADMIN_WALLET, isAdminWallet, CONTRACT_TARGETS, type ContractTarget } from "@/lib/admin";
import {
  buildDeployImplementationTx,
  buildDeployProxyTx,
  buildUpgradeTx,
  buildAdminMintTx,
  buildDeployAlbumBuyerTx,
  buildSetMintPriceTx,
} from "@/lib/contractDeploy";
import { wagmiConfig } from "@/lib/web3";
import { ALBUMS, type ChainKey } from "@/lib/albums";
import { getNativeTokenForChain } from "@/lib/dylTokens";
import { getTokenUsdPrice } from "@/lib/tokenUsdPrice";
import { priceUsdForEdition } from "@/lib/editionPricing";
import { encodeTokenId, decodeTokenId } from "@/lib/tokenIdScheme";
import { viemWalletClientToEthersSigner } from "@/lib/ethersSigner";
import { createSiteListings, cancelAllListings } from "@/lib/siteListing";
import { createOpenSeaListings, getOpenSeaSdk, isOpenSeaListable } from "@/lib/openSeaListing";
import { DylCollectionAbi } from "@/lib/contractDeploy";
import { useSolanaWallet, getConnection } from "@/lib/solana";
import { createSolanaAdminUmi, deploySolanaCollection, deployTrackAndMintAdmin, filterOwnedMints } from "@/lib/solanaAdmin";
import { listEditionsOnMagicEden, repriceEditionsOnMagicEden } from "@/lib/magicEdenListing";
import type { SolanaMintRecord } from "@/lib/solanaMintsStore";
import type { Address } from "viem";

interface ChatMessage {
  id: string;
  wallet: string;
  chain: string;
  text: string;
  ts: number;
}

// Admin-settable, no oracle (mirrors the contract's own admin-only
// setMintPrice) — a rough ETH-denominated stand-in for the site's $0.99
// public mint price, used only as the INITIAL value passed to initialize()
// at deploy time. Real re-pegging as ETH/USD moves afterward is the new
// "Reprice Mint Price" button below (buildSetMintPriceTx, computed live via
// getTokenUsdPrice) — added because this constant previously had no way to
// be revisited post-deploy at all short of a manual raw contract call
// outside the app.
const DEFAULT_MINT_PRICE_WEI = BigInt("300000000000000"); // 0.0003 ETH

// The flat public mint price every track's `priceUsd` in lib/albums.ts
// currently uses (see the `track()` helper's default) — the target the
// live mint-price re-peg and the Solana Candy Guard price both aim for.
const PUBLIC_MINT_USD = 0.99;

function metadataBaseURI(chainSlug: string) {
  return `https://dylmusic.vercel.app/api/metadata/${chainSlug}/`;
}

function truncate(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

type DeployPhase =
  | {
      step:
        | "implementation"
        | "proxy"
        | "albumBuyer"
        | "newImplementation"
        | "upgrade"
        | "mint"
        | "cancel"
        | "list-site"
        | "list-opensea"
        | "deploy"
        | "list"
        | "reprice"
        | "reprice-mint-price";
      label: string;
    }
  | { step: "done"; label: string }
  | { step: "error"; label: string };

export default function AdminPage() {
  const { address, isConnected, chainId: connectedChainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { sendTransactionAsync } = useSendTransaction();
  const { switchChainAsync } = useSwitchChain();
  const allowed = isAdminWallet(address);
  const solWallet = useSolanaWallet();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatConfigured, setChatConfigured] = useState<boolean | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [targets, setTargets] = useState<ContractTarget[]>(CONTRACT_TARGETS);
  const [phase, setPhase] = useState<Record<string, DeployPhase | undefined>>({});

  async function loadChat() {
    try {
      const res = await fetch("/api/chat", { cache: "no-store" });
      const data = await res.json();
      setChatConfigured(!!data.configured);
      setMessages(data.messages ?? []);
    } catch {
      setChatConfigured(false);
    }
  }

  useEffect(() => {
    if (allowed) loadChat();
  }, [allowed]);

  async function handleDelete(id: string) {
    if (!address) return;
    setDeletingId(id);
    try {
      await fetch("/api/chat", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, wallet: address }),
      });
      await loadChat();
    } finally {
      setDeletingId(null);
    }
  }

  function setTargetField(key: ContractTarget["key"], patch: Partial<ContractTarget>) {
    setTargets((prev) => prev.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  }

  async function ensureChain(target: ContractTarget) {
    if (!target.chainId) throw new Error(`No chainId configured for ${target.key}`);
    if (connectedChainId !== target.chainId) {
      await switchChainAsync({ chainId: target.chainId });
    }
  }

  // `chainId` is required and always used to fetch a FRESH public client via
  // getPublicClient (an imperative wagmi/actions call, not the reactive
  // usePublicClient() hook value at the top of this component) — the hook
  // value is a snapshot from whichever render was active before this
  // handler started, and does NOT reflect a switchChainAsync() call made
  // earlier in the SAME handler invocation (ensureChain runs before every
  // caller of this function). Using the stale hook value here would wait
  // for the transaction receipt on the WRONG chain's RPC whenever the admin
  // moves from one chain's row to another's without a full page reload —
  // the exact same class of staleness bug already fixed for the wallet
  // client elsewhere in this codebase (ensureEvmChain/freshClient patterns).
  async function sendAndWait(tx: { to?: Address; data: `0x${string}`; value: bigint }, chainId: number) {
    const hash = await sendTransactionAsync(tx);
    const freshPublicClient = getPublicClient(wagmiConfig, { chainId });
    const receipt = await freshPublicClient!.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`Transaction reverted: ${hash}`);
    return receipt;
  }

  async function handleDeploy(target: ContractTarget) {
    if (!address) return;
    try {
      await ensureChain(target);

      setPhase((p) => ({ ...p, [target.key]: { step: "implementation", label: "1/3 — Deploying implementation…" } }));
      const implReceipt = await sendAndWait(buildDeployImplementationTx(), target.chainId!);
      const implementationAddress = implReceipt.contractAddress as Address;
      if (!implementationAddress) throw new Error("No contractAddress in implementation deploy receipt");

      setPhase((p) => ({ ...p, [target.key]: { step: "proxy", label: "2/3 — Deploying proxy…" } }));
      const proxyReceipt = await sendAndWait(
        buildDeployProxyTx({
          implementationAddress,
          name: "Dyl",
          symbol: "DYL",
          admin: address as Address,
          initialMintPriceWei: DEFAULT_MINT_PRICE_WEI,
          initialMetadataBaseURI: metadataBaseURI(target.key),
        }),
        target.chainId!
      );
      const proxyAddress = proxyReceipt.contractAddress as Address;
      if (!proxyAddress) throw new Error("No contractAddress in proxy deploy receipt");

      setPhase((p) => ({ ...p, [target.key]: { step: "albumBuyer", label: "3/3 — Deploying AlbumBuyer…" } }));
      const albumBuyerReceipt = await sendAndWait(buildDeployAlbumBuyerTx(), target.chainId!);
      const albumBuyerAddress = albumBuyerReceipt.contractAddress as Address;

      setTargetField(target.key, {
        address: proxyAddress,
        implementationAddress,
        albumBuyerAddress: albumBuyerAddress ?? null,
      });
      setPhase((p) => ({
        ...p,
        [target.key]: {
          step: "done",
          label: `Deployed. Proxy ${truncate(proxyAddress)} — commit this into lib/admin.ts CONTRACT_TARGETS.`,
        },
      }));
    } catch (err) {
      setPhase((p) => ({ ...p, [target.key]: { step: "error", label: describeError(err) } }));
    }
  }

  async function handleUpgrade(target: ContractTarget) {
    if (!target.address) return;
    try {
      await ensureChain(target);
      setPhase((p) => ({ ...p, [target.key]: { step: "newImplementation", label: "1/2 — Deploying new implementation…" } }));
      const implReceipt = await sendAndWait(buildDeployImplementationTx(), target.chainId!);
      const newImplementationAddress = implReceipt.contractAddress as Address;
      if (!newImplementationAddress) throw new Error("No contractAddress in implementation deploy receipt");

      setPhase((p) => ({ ...p, [target.key]: { step: "upgrade", label: "2/2 — Calling upgradeToAndCall…" } }));
      await sendAndWait(buildUpgradeTx(target.address as Address, newImplementationAddress), target.chainId!);

      setTargetField(target.key, { implementationAddress: newImplementationAddress });
      setPhase((p) => ({
        ...p,
        [target.key]: { step: "done", label: `Upgraded. New implementation ${truncate(newImplementationAddress)}.` },
      }));
    } catch (err) {
      setPhase((p) => ({ ...p, [target.key]: { step: "error", label: describeError(err) } }));
    }
  }

  // Mints editions #1-10 for EVERY real track (all 19 on Crypto Rich
  // (Deluxe) today — 190 NFTs total on this chain), then lists every one of
  // those 190 editions TWICE: once as a genuinely free, non-expiring
  // Seaport order signed straight to our own site (lib/siteListing.ts), and
  // once posted through OpenSea's own Order Posting API so it is actually
  // visible on opensea.io (lib/openSeaListing.ts, their real 1% fee, capped
  // at their own 6-month maximum listing duration — "never expire" is not
  // possible on their side, confirmed against their own docs; renewing
  // those before they lapse is a manual admin action, not automated).
  // Pricing is the inverse-rarity scale from CLAUDE.md's "Deployment
  // minting strategy": edition #10 lists at $10 up to edition #1 at $100,
  // converted into the chain's native currency at the live rate.
  async function handleMintAndListAlbum(target: ContractTarget) {
    if (!target.address || !address || !target.chainId) return;
    const chainKey = target.key as ChainKey; // only called for the 3 EVM targets (robinhood/base/ethereum) — see the `evm` check at the call site
    const tracks = ALBUMS.flatMap((a) => a.tracks);
    if (tracks.length === 0) return;
    // Set synchronously, before any await, so a rapid double-click (or a
    // second browser tab) can't start a second concurrent run before React
    // re-renders the disabled button — busy() only reads phase state, and
    // the previous version's first setPhase call was already past several
    // awaits, leaving a real window where the button wasn't yet disabled.
    setPhase((p) => ({ ...p, [target.key]: { step: "mint", label: "Starting…" } }));
    try {
      await ensureChain(target);

      // Fresh, chain-scoped public client for the resumability reads below —
      // NOT the reactive usePublicClient() hook value from the top of this
      // component, which is a snapshot from before ensureChain's switch
      // above and would silently read the WRONG chain otherwise (same
      // staleness class as sendAndWait's own fix, see its comment).
      const freshReadClient = getPublicClient(wagmiConfig, { chainId: target.chainId! });

      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        // Resumable: adminMint's on-chain nextEditionIndex counter is
        // binary per track (0 or 10, since this flow only ever mints in
        // one quantity=10 call) — skip any track already fully minted so
        // a partial failure can be recovered by just re-clicking this
        // button, instead of hard-reverting with AdminAllocationExceeded
        // on the very first already-done track.
        const alreadyMinted = (await freshReadClient!.readContract({
          address: target.address as Address,
          abi: DylCollectionAbi,
          functionName: "nextEditionIndex",
          args: [BigInt(track.index)],
        })) as bigint;
        if (alreadyMinted >= BigInt(10)) {
          setPhase((p) => ({
            ...p,
            [target.key]: { step: "mint", label: `Skipping "${track.title}" — already minted (track ${i + 1}/${tracks.length})…` },
          }));
          continue;
        }
        setPhase((p) => ({
          ...p,
          [target.key]: { step: "mint", label: `Minting "${track.title}" #1-10 (track ${i + 1}/${tracks.length})…` },
        }));
        await sendAndWait(
          buildAdminMintTx(target.address as Address, BigInt(track.index), BigInt(10), address as Address),
          target.chainId!
        );
      }

      const nativeToken = getNativeTokenForChain(chainKey);
      const nativeUsd = await getTokenUsdPrice(nativeToken);
      if (!nativeUsd) {
        throw new Error(`Minted all editions, but could not price ${nativeToken.symbol} right now — try listing again shortly.`);
      }

      // Skip editions that already have a stored site listing — without
      // this, safely re-running this button after a resumed partial mint
      // (or just clicking it twice by mistake) would re-sign and
      // re-submit fresh orders for all 190 editions every time, including
      // ones already correctly listed from a prior run. Not fund-loss
      // (Seaport allows multiple valid orders for the same token; whichever
      // fills first wins), but wasteful and unnecessary — "Reprice &
      // Relist" is the existing, correct tool for intentionally replacing
      // an already-active listing.
      const existingListingsRes = await fetch(`/api/listings?chainId=${target.chainId}`);
      const existingListingsData = await existingListingsRes.json().catch(() => ({ listings: [] }));
      const alreadyListedTokenIds = new Set<number>(
        (existingListingsData?.listings ?? []).map((l: { tokenId: number }) => l.tokenId)
      );

      const editions = tracks
        .flatMap((track) =>
          Array.from({ length: 10 }, (_, e) => {
            const editionNumber = e + 1;
            const priceUsd = priceUsdForEdition(editionNumber);
            const priceWei = BigInt(Math.round((priceUsd / nativeUsd) * 1e18));
            return { tokenId: encodeTokenId(track.index, editionNumber), priceWei };
          })
        )
        .filter((e) => !alreadyListedTokenIds.has(e.tokenId));

      if (editions.length === 0) {
        setPhase((p) => ({
          ...p,
          [target.key]: { step: "done", label: `Minted all editions. Every edition was already listed — nothing new to list.` },
        }));
        return;
      }

      // A fresh viem client for THIS chain, not the reactive useWalletClient()
      // hook value — that snapshot can still reflect the chain the wallet
      // was on before ensureChain's own switch above (same staleness bug
      // already fixed for /swap's ensureEvmChain, same fix here).
      const freshClient = await getWalletClient(wagmiConfig, { chainId: target.chainId });
      const signer = await viemWalletClientToEthersSigner(freshClient);

      setPhase((p) => ({
        ...p,
        [target.key]: { step: "list-site", label: `Signing ${editions.length} listings for our own site (0% fee, never expires)…` },
      }));
      const siteOrders = await createSiteListings(
        signer,
        editions.map((e) => ({
          collectionAddress: target.address as string,
          tokenId: e.tokenId,
          priceWei: e.priceWei,
          sellerAddress: address,
        }))
      );
      const listingsRes = await fetch("/api/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: address,
          listings: siteOrders.map((o, idx) => ({
            chainId: target.chainId,
            collectionAddress: target.address,
            tokenId: editions[idx].tokenId,
            priceWei: editions[idx].priceWei.toString(),
            sellerAddress: address,
            parameters: o.parameters,
            signature: o.signature,
            createdAt: Date.now(),
          })),
        }),
      });
      const listingsData = await listingsRes.json().catch(() => null);
      if (!listingsRes.ok || !listingsData?.ok) {
        // Real, signed, on-chain-fulfillable Seaport orders exist only in
        // this browser's memory until this succeeds — a Redis hiccup here
        // used to be silently swallowed and reported as full success.
        throw new Error(
          `Minted all editions and signed ${siteOrders.length} site listings, but failed to save them to the server (status ${listingsRes.status}) — they are NOT yet visible on the site. Retry "Mint #1-10 & List" (already-minted tracks will be skipped) or check Upstash Redis env vars.`
        );
      }

      let openSeaFailures = 0;
      if (isOpenSeaListable(chainKey)) {
        setPhase((p) => ({
          ...p,
          [target.key]: { step: "list-opensea", label: `Posting ${editions.length} listings to OpenSea (1% fee, 6-month expiry)…` },
        }));
        const sdk = getOpenSeaSdk(signer, chainKey);
        const result = await createOpenSeaListings(
          sdk,
          editions.map((e) => ({
            collectionAddress: target.address as string,
            tokenId: e.tokenId,
            priceWei: e.priceWei,
            sellerAddress: address,
          }))
        );
        openSeaFailures = result.failed.length;
        if (openSeaFailures > 0) {
          console.error(`OpenSea listing failures for ${target.chainName}:`, result.failed);
        }
      }

      setPhase((p) => ({
        ...p,
        [target.key]: {
          step: "done",
          label:
            openSeaFailures > 0
              ? `Minted + listed ${editions.length} editions across ${tracks.length} tracks. ${openSeaFailures} OpenSea listing(s) failed — see console.`
              : `Minted + listed ${editions.length} editions across ${tracks.length} tracks, on our site and OpenSea.`,
        },
      }));
    } catch (err) {
      setPhase((p) => ({ ...p, [target.key]: { step: "error", label: describeError(err) } }));
    }
  }

  // "Reprice & Relist" — for adjusting already-minted editions #1-10 to a
  // fresh USD peg (crypto moves, the original listing's native-currency
  // price doesn't) without ever building a price oracle/keeper — this is a
  // manual admin action Dylan triggers when he wants to, same "let me
  // manually decide" call as the rest of this pricing scheme.
  //
  // The real risk this guards against: our own site's listings are signed
  // to never expire, so just signing NEW orders at the new price would
  // leave the OLD (now underpriced) orders still fulfillable by anyone
  // holding a cached copy — cancelAllListings (Seaport's own
  // incrementCounter, one on-chain tx) invalidates every previously-signed
  // order from this wallet on this chain, both the site half AND the
  // OpenSea half at once, before any new ones are signed. Re-listing
  // through OpenSea's API also happens to reset their 6-month expiry clock
  // for free, since it's a brand new listing submission either way.
  //
  // Only re-lists editions the admin wallet STILL owns (tokensOfOwner,
  // read live on-chain) — anything already sold to a real buyer isn't
  // admin's to relist, and simply won't come back from that call.
  async function handleRepriceAndRelist(target: ContractTarget) {
    if (!target.address || !address || !target.chainId) return;
    const chainKey = target.key as ChainKey; // only called for the 3 EVM targets — see the `evm` check at the call site
    // Set synchronously before any await — see the identical comment in
    // handleMintAndListAlbum. Matters even more here: two concurrent runs
    // both calling cancelAllListings() can interleave (whichever's
    // incrementCounter lands second invalidates the first's freshly-signed
    // orders), which would leave Redis holding listings that display
    // normally on the site but can never actually be fulfilled.
    setPhase((p) => ({ ...p, [target.key]: { step: "cancel", label: "Starting…" } }));
    try {
      await ensureChain(target);

      // Fresh, chain-scoped client — same staleness reasoning as
      // sendAndWait/handleMintAndListAlbum's freshReadClient above; this
      // read happens right after ensureChain's own chain switch, so the
      // reactive usePublicClient() hook value from render time can't be
      // trusted here either.
      const freshReadClient = getPublicClient(wagmiConfig, { chainId: target.chainId! });
      const owned = (await freshReadClient!.readContract({
        address: target.address as Address,
        abi: DylCollectionAbi,
        functionName: "tokensOfOwner",
        args: [address as Address],
      })) as bigint[];

      const editions = owned
        .map((id) => ({ tokenId: Number(id), ...decodeTokenId(Number(id)) }))
        .filter((e) => e.editionNumber >= 1 && e.editionNumber <= 10);

      if (editions.length === 0) {
        setPhase((p) => ({
          ...p,
          [target.key]: { step: "done", label: "Nothing to reprice — no admin-held #1-10 editions on this chain." },
        }));
        return;
      }

      const nativeToken = getNativeTokenForChain(chainKey);
      const nativeUsd = await getTokenUsdPrice(nativeToken);
      if (!nativeUsd) {
        throw new Error(`Could not price ${nativeToken.symbol} right now — try again shortly.`);
      }
      const priced = editions.map((e) => ({
        tokenId: e.tokenId,
        priceWei: BigInt(Math.round((priceUsdForEdition(e.editionNumber) / nativeUsd) * 1e18)),
      }));

      const freshClient = await getWalletClient(wagmiConfig, { chainId: target.chainId });
      const signer = await viemWalletClientToEthersSigner(freshClient);

      setPhase((p) => ({
        ...p,
        [target.key]: { step: "cancel", label: `1/3 — Cancelling ${editions.length} old listing(s)…` },
      }));
      await cancelAllListings(signer);

      setPhase((p) => ({
        ...p,
        [target.key]: { step: "list-site", label: `2/3 — Signing ${priced.length} fresh listings for our own site…` },
      }));
      const siteOrders = await createSiteListings(
        signer,
        priced.map((e) => ({
          collectionAddress: target.address as string,
          tokenId: e.tokenId,
          priceWei: e.priceWei,
          sellerAddress: address,
        }))
      );
      const listingsRes = await fetch("/api/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: address,
          listings: siteOrders.map((o, idx) => ({
            chainId: target.chainId,
            collectionAddress: target.address,
            tokenId: priced[idx].tokenId,
            priceWei: priced[idx].priceWei.toString(),
            sellerAddress: address,
            parameters: o.parameters,
            signature: o.signature,
            createdAt: Date.now(),
          })),
        }),
      });
      const listingsData = await listingsRes.json().catch(() => null);
      if (!listingsRes.ok || !listingsData?.ok) {
        throw new Error(
          `Cancelled old listings and signed ${siteOrders.length} fresh ones, but failed to save them to the server (status ${listingsRes.status}) — the OLD listings are now cancelled on-chain and the NEW ones are NOT yet visible on the site. Retry immediately or check Upstash Redis env vars.`
        );
      }

      let openSeaFailures = 0;
      if (isOpenSeaListable(chainKey)) {
        setPhase((p) => ({
          ...p,
          [target.key]: { step: "list-opensea", label: `3/3 — Posting ${priced.length} fresh listings to OpenSea (6-month expiry)…` },
        }));
        const sdk = getOpenSeaSdk(signer, chainKey);
        const result = await createOpenSeaListings(
          sdk,
          priced.map((e) => ({
            collectionAddress: target.address as string,
            tokenId: e.tokenId,
            priceWei: e.priceWei,
            sellerAddress: address,
          }))
        );
        openSeaFailures = result.failed.length;
        if (openSeaFailures > 0) {
          console.error(`OpenSea relisting failures for ${target.chainName}:`, result.failed);
        }
      }

      setPhase((p) => ({
        ...p,
        [target.key]: {
          step: "done",
          label:
            openSeaFailures > 0
              ? `Repriced + relisted ${priced.length} editions. ${openSeaFailures} OpenSea listing(s) failed — see console.`
              : `Repriced + relisted ${priced.length} editions at the current USD peg, on our site and OpenSea.`,
        },
      }));
    } catch (err) {
      setPhase((p) => ({ ...p, [target.key]: { step: "error", label: describeError(err) } }));
    }
  }

  // "Reprice Mint Price" — re-pegs the ONGOING public mint price (editions
  // #11-100, the actual $0.99-per-mint number advertised sitewide) to the
  // current USD rate. Before this existed, DEFAULT_MINT_PRICE_WEI was set
  // once at deploy time and never revisited by anything in this app —
  // buildSetMintPriceTx (lib/contractDeploy.ts) already existed but had no
  // caller anywhere, so as ETH/native-token price moved, the real USD cost
  // of a public mint would silently drift with no in-app way to correct it
  // short of a manual raw contract call outside this panel.
  async function handleRepriceMintPrice(target: ContractTarget) {
    if (!target.address || !target.chainId) return;
    const chainKey = target.key as ChainKey;
    setPhase((p) => ({ ...p, [target.key]: { step: "reprice-mint-price", label: "Starting…" } }));
    try {
      await ensureChain(target);
      const nativeToken = getNativeTokenForChain(chainKey);
      const nativeUsd = await getTokenUsdPrice(nativeToken);
      if (!nativeUsd) throw new Error(`Could not price ${nativeToken.symbol} right now — try again shortly.`);
      const newPriceWei = BigInt(Math.round((PUBLIC_MINT_USD / nativeUsd) * 1e18));

      setPhase((p) => ({
        ...p,
        [target.key]: { step: "reprice-mint-price", label: `Setting mint price to $${PUBLIC_MINT_USD} (${newPriceWei} wei)…` },
      }));
      await sendAndWait(buildSetMintPriceTx(target.address as Address, newPriceWei), target.chainId!);

      setPhase((p) => ({
        ...p,
        [target.key]: { step: "done", label: `Mint price re-pegged to $${PUBLIC_MINT_USD} (${newPriceWei} wei per edition).` },
      }));
    } catch (err) {
      setPhase((p) => ({ ...p, [target.key]: { step: "error", label: describeError(err) } }));
    }
  }

  // ---- Solana: same three admin actions as the EVM chains, real per-chain
  // shape differences (see the comments inside lib/solanaAdmin.ts and
  // lib/magicEdenListing.ts) — one Candy Machine per track instead of one
  // mint call into a shared contract, Magic Eden instead of OpenSea/Seaport,
  // and no on-chain enumeration of admin holdings (tracked in Redis at mint
  // time instead, see lib/solanaMintsStore.ts). Requires BOTH the connected
  // EVM admin wallet (gates /admin itself) AND a connected Phantom wallet
  // (signs every Solana instruction) — same dual-wallet requirement the
  // real cross-chain swap flow already established.

  async function handleDeploySolanaCollection() {
    const provider = solWallet.getProvider();
    if (!provider || !solWallet.address) return;
    try {
      setPhase((p) => ({ ...p, solana: { step: "deploy", label: "Deploying Collection NFT…" } }));
      const umi = createSolanaAdminUmi(provider);
      const { mint } = await deploySolanaCollection(umi);
      setTargetField("solana", { address: mint });
      setPhase((p) => ({
        ...p,
        solana: { step: "done", label: `Collection deployed: ${truncate(mint)} — commit this into lib/admin.ts CONTRACT_TARGETS.` },
      }));
    } catch (err) {
      setPhase((p) => ({ ...p, solana: { step: "error", label: describeError(err) } }));
    }
  }

  async function handleSolanaMintAndList(target: ContractTarget) {
    const provider = solWallet.getProvider();
    if (!provider || !solWallet.address || !target.address) return;
    const tracks = ALBUMS.flatMap((a) => a.tracks);
    // Synchronous, before any await — same double-click guard as the EVM
    // handlers above.
    setPhase((p) => ({ ...p, solana: { step: "mint", label: "Starting…" } }));
    try {
      // Fail fast: minting spends real SOL/rent immediately, but listing
      // (which needs this key) used to only happen afterward — a missing
      // key meant burning real funds on real mints before ever discovering
      // they can't be listed. Check before touching the mint loop at all.
      if (!process.env.NEXT_PUBLIC_MAGIC_EDEN_API_KEY) {
        throw new Error(
          "NEXT_PUBLIC_MAGIC_EDEN_API_KEY is not set — request one at docs.magiceden.io and add it to the environment before running this."
        );
      }

      const nativeToken = getNativeTokenForChain("solana");
      const solUsd = await getTokenUsdPrice(nativeToken);
      if (!solUsd) throw new Error("Could not price SOL right now — try again shortly.");

      // Resumable: a track already fully recorded (10 admin editions) must
      // NOT be re-run — deployTrackAndMintAdmin always creates a BRAND NEW
      // Candy Machine with no awareness of prior runs, so re-running it for
      // an already-done track would mint a second, fully separate Candy
      // Machine whose config lines reuse the exact same tokenId strings
      // (a pure function of trackId/edition) as the first — two different
      // real NFT mints both claiming the same tokenId.
      setPhase((p) => ({ ...p, solana: { step: "mint", label: "Checking existing progress…" } }));
      const existingRes = await fetch("/api/solana-mints");
      const existingData = (await existingRes.json().catch(() => ({ mints: [] as SolanaMintRecord[] }))) as {
        mints: SolanaMintRecord[];
      };
      const existingByTrack = new Map<number, SolanaMintRecord[]>();
      for (const m of existingData.mints ?? []) {
        if (!existingByTrack.has(m.trackId)) existingByTrack.set(m.trackId, []);
        existingByTrack.get(m.trackId)!.push(m);
      }

      const umi = createSolanaAdminUmi(provider);
      const allMinted: SolanaMintRecord[] = [...(existingData.mints ?? [])];

      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        const already = existingByTrack.get(track.index) ?? [];
        if (already.length >= 10) {
          setPhase((p) => ({
            ...p,
            solana: { step: "mint", label: `Skipping "${track.title}" — already minted (track ${i + 1}/${tracks.length})…` },
          }));
          continue;
        }
        // Priced from the real track data (editionCap/priceUsd), not a
        // flat hardcoded guess — the old `priceLamports: 300000` constant
        // was never actually pegged to $0.99 in SOL terms at all (SOL and
        // ETH trade at very different per-unit prices, unlike the rough
        // ETH-denominated guess used on the EVM side).
        const priceLamports = Math.round((track.priceUsd / solUsd) * 1_000_000_000);
        const result = await deployTrackAndMintAdmin(
          umi,
          { trackId: track.index, title: track.title, collectionMint: target.address as string, editions: track.editionCap, priceLamports },
          (label) => setPhase((p) => ({ ...p, solana: { step: "mint", label: `Track ${i + 1}/${tracks.length} — ${label}` } }))
        );
        const trackMints: SolanaMintRecord[] = result.editions.map((e) => ({
          trackId: track.index,
          editionNumber: e.editionNumber,
          tokenId: e.tokenId,
          mint: e.mint,
          candyMachine: result.candyMachine,
        }));
        allMinted.push(...trackMints);

        // Persist THIS track's mints immediately — not just once at the
        // very end of all 19 tracks. Real, paid-for, on-chain mints for
        // tracks 1..k must survive a crash/RPC failure on track k+1
        // instead of existing only in this function's local memory.
        setPhase((p) => ({ ...p, solana: { step: "mint", label: `Saving progress for "${track.title}"…` } }));
        const saveRes = await fetch("/api/solana-mints", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet: address, mints: trackMints }),
        });
        const saveData = await saveRes.json().catch(() => null);
        if (!saveRes.ok || !saveData?.ok) {
          throw new Error(
            `Minted "${track.title}" (real, on-chain, paid for) but failed to save that progress to the server (status ${saveRes.status}). Do NOT re-run yet — check Upstash Redis env vars first, or this track's mints will be re-minted from scratch under a second Candy Machine.`
          );
        }
      }

      const toList = allMinted.filter((m) => m.editionNumber >= 1 && m.editionNumber <= 10 && m.listedPriceSol === undefined);
      const priced = toList.map((m) => ({ mint: m.mint, priceSol: priceUsdForEdition(m.editionNumber) / solUsd }));

      setPhase((p) => ({ ...p, solana: { step: "list", label: `Listing ${priced.length} edition(s) on Magic Eden…` } }));
      const connection = getConnection();
      const listResult = await listEditionsOnMagicEden(
        provider,
        connection,
        solWallet.address,
        priced,
        (done, total) => setPhase((p) => ({ ...p, solana: { step: "list", label: `Listing on Magic Eden… ${done}/${total}` } }))
      );

      // Only record success for editions Magic Eden actually confirmed —
      // an optimistic write here (marking a failed listing as listed
      // anyway) is a real, self-perpetuating bug: the NEXT reprice attempt
      // would send the wrong "current price" to sell_change_price (which
      // needs the real existing listing price as input), fail for the same
      // reason, forever, until someone manually fixes the Redis record.
      const failedMints = new Set(listResult.failed.map((f) => f.mint));
      const updated: SolanaMintRecord[] = toList
        .filter((m) => !failedMints.has(m.mint))
        .map((m) => ({ ...m, listedPriceSol: priceUsdForEdition(m.editionNumber) / solUsd }));

      if (updated.length > 0) {
        const saveRes = await fetch("/api/solana-mints", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet: address, mints: updated }),
        });
        const saveData = await saveRes.json().catch(() => null);
        if (!saveRes.ok || !saveData?.ok) {
          console.error("Failed to save Magic Eden listing state to the server", saveRes.status);
        }
      }

      if (listResult.failed.length > 0) console.error("Magic Eden listing failures:", listResult.failed);
      setPhase((p) => ({
        ...p,
        solana: {
          step: "done",
          label:
            listResult.failed.length > 0
              ? `Minted/verified ${allMinted.length} editions across ${tracks.length} tracks. ${listResult.failed.length} Magic Eden listing(s) failed — see console.`
              : `Minted + listed ${priced.length} new edition(s) (${allMinted.length} total across ${tracks.length} tracks) on Magic Eden.`,
        },
      }));
    } catch (err) {
      setPhase((p) => ({ ...p, solana: { step: "error", label: describeError(err) } }));
    }
  }

  async function handleSolanaReprice() {
    const provider = solWallet.getProvider();
    if (!provider || !solWallet.address) return;
    // Synchronous, before any await — same double-click guard as above.
    setPhase((p) => ({ ...p, solana: { step: "reprice", label: "Starting…" } }));
    try {
      if (!process.env.NEXT_PUBLIC_MAGIC_EDEN_API_KEY) {
        throw new Error(
          "NEXT_PUBLIC_MAGIC_EDEN_API_KEY is not set — request one at docs.magiceden.io and add it to the environment before running this."
        );
      }
      setPhase((p) => ({ ...p, solana: { step: "reprice", label: "Checking current holdings…" } }));
      const connection = getConnection();
      const res = await fetch("/api/solana-mints");
      const { mints } = (await res.json()) as { mints: SolanaMintRecord[] };
      const eligible = mints.filter((m) => m.editionNumber >= 1 && m.editionNumber <= 10);
      const owned = await filterOwnedMints(connection, eligible, solWallet.address);

      if (owned.length === 0) {
        setPhase((p) => ({ ...p, solana: { step: "done", label: "Nothing to reprice — no admin-held #1-10 editions on Solana." } }));
        return;
      }

      const nativeToken = getNativeTokenForChain("solana");
      const solUsd = await getTokenUsdPrice(nativeToken);
      if (!solUsd) throw new Error("Could not price SOL right now — try again shortly.");

      const alreadyListed = owned.filter((m) => m.listedPriceSol !== undefined);
      const notYetListed = owned.filter((m) => m.listedPriceSol === undefined);

      setPhase((p) => ({ ...p, solana: { step: "reprice", label: `Repricing ${alreadyListed.length} listing(s)…` } }));
      const repriceResult = await repriceEditionsOnMagicEden(
        provider,
        connection,
        solWallet.address,
        alreadyListed.map((m) => ({
          mint: m.mint,
          currentPriceSol: m.listedPriceSol!,
          newPriceSol: priceUsdForEdition(m.editionNumber) / solUsd,
        })),
        (done, total) => setPhase((p) => ({ ...p, solana: { step: "reprice", label: `Repricing… ${done}/${total}` } }))
      );

      let listFailedMints = new Set<string>();
      if (notYetListed.length > 0) {
        setPhase((p) => ({ ...p, solana: { step: "reprice", label: `Listing ${notYetListed.length} not-yet-listed edition(s)…` } }));
        const listResult = await listEditionsOnMagicEden(
          provider,
          connection,
          solWallet.address,
          notYetListed.map((m) => ({ mint: m.mint, priceSol: priceUsdForEdition(m.editionNumber) / solUsd }))
        );
        listFailedMints = new Set(listResult.failed.map((f) => f.mint));
      }

      // Only mark editions Magic Eden actually confirmed — see the
      // identical reasoning in handleSolanaMintAndList. Writing the new
      // price for an item whose reprice/list call actually failed would
      // desync Redis from the real on-chain listing price, silently
      // breaking every future reprice attempt for that item.
      const repriceFailedMints = new Set(repriceResult.failed.map((f) => f.mint));
      const updated: SolanaMintRecord[] = owned
        .filter((m) => !repriceFailedMints.has(m.mint) && !listFailedMints.has(m.mint))
        .map((m) => ({ ...m, listedPriceSol: priceUsdForEdition(m.editionNumber) / solUsd }));

      if (updated.length > 0) {
        const saveRes = await fetch("/api/solana-mints", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet: address, mints: updated }),
        });
        const saveData = await saveRes.json().catch(() => null);
        if (!saveRes.ok || !saveData?.ok) {
          console.error("Failed to save Magic Eden reprice state to the server", saveRes.status);
        }
      }

      const failures = repriceResult.failed.length + listFailedMints.size;
      if (failures > 0) console.error("Magic Eden reprice failures:", repriceResult.failed);
      setPhase((p) => ({
        ...p,
        solana: {
          step: "done",
          label:
            failures > 0
              ? `Repriced ${owned.length} edition(s) to the current USD peg. ${failures} Magic Eden call(s) failed — see console.`
              : `Repriced ${owned.length} edition(s) to the current USD peg on Magic Eden.`,
        },
      }));
    } catch (err) {
      setPhase((p) => ({ ...p, solana: { step: "error", label: describeError(err) } }));
    }
  }

  function describeError(err: unknown): string {
    if (err instanceof Error) return err.message;
    return "Unknown error — see console.";
  }

  const busy = (key: string) => {
    const s = phase[key]?.step;
    return s !== undefined && s !== "done" && s !== "error";
  };

  return (
    <div className="admin-wrap">
      <div className="admin-head">
        <span className="admin-logo">Dyl</span>
        <span className="admin-badge">ADMIN</span>
      </div>

      {!isConnected ? (
        <div className="admin-gate">
          <p>Connect the admin wallet to continue.</p>
          <button className="btn-connect" onClick={openConnectModal}>
            Connect Wallet
          </button>
        </div>
      ) : !allowed ? (
        <div className="admin-gate">
          <p>Access denied.</p>
          <p className="admin-gate-sub">
            Connected as {truncate(address!)} — this isn&apos;t the admin wallet.
          </p>
        </div>
      ) : (
        <div className="admin-body">
          <div className="admin-section">
            <div className="admin-section-head">
              <h2>Platform Status</h2>
            </div>
            <div className="admin-status-row">
              <span>Admin wallet</span>
              <span className="admin-status-val">{truncate(ADMIN_WALLET)}</span>
            </div>
            <div className="admin-status-row">
              <span>Chat backend (Upstash)</span>
              <span className={`admin-status-val${chatConfigured ? " ok" : " warn"}`}>
                {chatConfigured === null ? "…" : chatConfigured ? "Configured" : "Not configured"}
              </span>
            </div>
          </div>

          <div className="admin-section">
            <div className="admin-section-head">
              <h2>Chat Moderation</h2>
              <button className="admin-refresh" onClick={loadChat}>
                Refresh
              </button>
            </div>
            {messages.length === 0 ? (
              <div className="admin-empty">No messages.</div>
            ) : (
              <div className="admin-chat-list">
                {messages.map((m) => (
                  <div key={m.id} className="admin-chat-row">
                    <div className="admin-chat-row-text">
                      <strong>{truncate(m.wallet)}</strong> ({m.chain}): {m.text}
                    </div>
                    <button
                      className="admin-delete-btn"
                      disabled={deletingId === m.id}
                      onClick={() => handleDelete(m.id)}
                    >
                      {deletingId === m.id ? "…" : "Delete"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="admin-section">
            <div className="admin-section-head">
              <h2>Contracts — deploy in this order</h2>
            </div>
            <div className="admin-empty" style={{ marginBottom: 14 }}>
              One upgradable collection contract per chain — every track/album mints onto the
              existing contract as a new tokenId, never a new contract. ERC721A, not ERC-1155
              (decided 2026-07-28). See CLAUDE.md &quot;Contract Requirement&quot; before writing any
              of these. Steps 1–4 are required; step 5 (marketplace) is optional — only do it if
              OpenSea&apos;s own listing flow (Seaport) turns out not to be enough. Deploy also
              deploys that chain&apos;s AlbumBuyer wrapper in the same 3-transaction flow. Solana
              (step 4) needs a connected Phantom wallet in addition to the admin EVM wallet above —
              one Candy Machine gets created per track (not one shared contract), so &quot;Mint #1-10
              &amp; List&quot; means one Phantom prompt per instruction, per track. Lists through Magic
              Eden, which needs its own API key (<code>NEXT_PUBLIC_MAGIC_EDEN_API_KEY</code>) before
              the listing half will succeed.
            </div>
            {!solWallet.address && (
              <div className="admin-empty" style={{ marginBottom: 14 }}>
                Phantom not connected — required for the Solana row below.{" "}
                <button className="admin-refresh" onClick={solWallet.connect}>
                  Connect Phantom
                </button>
              </div>
            )}
            <div className="admin-contract-list">
              {targets.map((c) => {
                const p = phase[c.key];
                const evm = c.key === "robinhood" || c.key === "base" || c.key === "ethereum";
                const isSolana = c.key === "solana";
                return (
                  <div key={c.key} className={`admin-contract-row${c.optional ? " optional" : ""}`}>
                    <div className="admin-contract-step">{c.order}</div>
                    <div className="admin-contract-info">
                      <div className="admin-contract-chain">
                        {c.chainName}
                        {c.optional && <span className="admin-contract-optional-tag">Optional</span>}
                      </div>
                      <div className="admin-contract-standard">{c.standard}</div>
                      <div className="admin-contract-reason">{c.reason}</div>
                      <div className="admin-contract-addr">{c.address ?? "Not deployed"}</div>
                      {c.albumBuyerAddress && (
                        <div className="admin-contract-addr">AlbumBuyer: {c.albumBuyerAddress}</div>
                      )}
                      {p && (
                        <div className={`admin-contract-addr${p.step === "error" ? " warn" : ""}`}>{p.label}</div>
                      )}
                    </div>
                    {evm ? (
                      <div className="admin-contract-actions">
                        <button
                          className="admin-contract-btn"
                          disabled={busy(c.key) || !!c.address}
                          onClick={() => handleDeploy(c)}
                        >
                          Deploy
                        </button>
                        <button
                          className="admin-contract-btn"
                          disabled={busy(c.key) || !c.address}
                          onClick={() => handleUpgrade(c)}
                        >
                          Upgrade
                        </button>
                        <button
                          className="admin-contract-btn"
                          disabled={busy(c.key) || !c.address}
                          title="Mints editions #1-10 for every real track to the admin wallet, then lists each one on our own site (0% fee, never expires) and on OpenSea (their 1% fee, 6-month expiry — renew manually before it lapses). Price scale: edition #10 = $10 up to edition #1 = $100."
                          onClick={() => handleMintAndListAlbum(c)}
                        >
                          Mint #1-10 &amp; List
                        </button>
                        <button
                          className="admin-contract-btn"
                          disabled={busy(c.key) || !c.address}
                          title="Re-prices every #1-10 edition the admin wallet still holds to the current USD peg (cancels all old listings on-chain first, so nothing stays fulfillable at the old price), and re-lists on our site and OpenSea — which also resets OpenSea's 6-month listing clock."
                          onClick={() => handleRepriceAndRelist(c)}
                        >
                          Reprice &amp; Relist
                        </button>
                        <button
                          className="admin-contract-btn"
                          disabled={busy(c.key) || !c.address}
                          title={`Re-pegs the ONGOING public mint price (editions #11-100) to $${PUBLIC_MINT_USD} at the current rate — the initial deploy-time price is just a flat guess and never updates on its own as ${getNativeTokenForChain(c.key as ChainKey).symbol} price moves.`}
                          onClick={() => handleRepriceMintPrice(c)}
                        >
                          Reprice Mint Price
                        </button>
                      </div>
                    ) : isSolana ? (
                      <div className="admin-contract-actions">
                        <button
                          className="admin-contract-btn"
                          disabled={busy(c.key) || !!c.address || !solWallet.address}
                          onClick={handleDeploySolanaCollection}
                        >
                          Deploy
                        </button>
                        <button
                          className="admin-contract-btn"
                          disabled={busy(c.key) || !c.address || !solWallet.address}
                          title="Creates one Candy Machine per track, mints editions #1-10 straight to the admin wallet, then lists each one on Magic Eden. Price scale: edition #10 = $10 up to edition #1 = $100. One Phantom prompt per instruction, per track."
                          onClick={() => handleSolanaMintAndList(c)}
                        >
                          Mint #1-10 &amp; List
                        </button>
                        <button
                          className="admin-contract-btn"
                          disabled={busy(c.key) || !c.address || !solWallet.address}
                          title="Re-prices every #1-10 edition the admin wallet still holds to the current USD peg via Magic Eden's own change-price instruction (no cancel needed), and lists anything recorded but not yet listed."
                          onClick={handleSolanaReprice}
                        >
                          Reprice &amp; Relist
                        </button>
                      </div>
                    ) : (
                      <div className="admin-contract-actions">
                        <button className="admin-contract-btn" disabled>
                          Deploy
                        </button>
                        <button className="admin-contract-btn" disabled>
                          Upgrade
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
