"use client";

import { useEffect, useState } from "react";
import { useAccount, usePublicClient, useSendTransaction, useSwitchChain } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { ADMIN_WALLET, isAdminWallet, CONTRACT_TARGETS, type ContractTarget } from "@/lib/admin";
import {
  buildDeployImplementationTx,
  buildDeployProxyTx,
  buildUpgradeTx,
  buildAdminMintTx,
  buildDeployAlbumBuyerTx,
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
// public mint price. Fine-tune per chain after deploy via setMintPrice as
// ETH/USD drifts; this is only ever the INITIAL value passed to initialize().
const DEFAULT_MINT_PRICE_WEI = BigInt("300000000000000"); // 0.0003 ETH

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
        | "reprice";
      label: string;
    }
  | { step: "done"; label: string }
  | { step: "error"; label: string };

export default function AdminPage() {
  const { address, isConnected, chainId: connectedChainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { sendTransactionAsync } = useSendTransaction();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient();
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

  async function sendAndWait(tx: { to?: Address; data: `0x${string}`; value: bigint }) {
    const hash = await sendTransactionAsync(tx);
    const receipt = await publicClient!.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`Transaction reverted: ${hash}`);
    return receipt;
  }

  async function handleDeploy(target: ContractTarget) {
    if (!address) return;
    try {
      await ensureChain(target);

      setPhase((p) => ({ ...p, [target.key]: { step: "implementation", label: "1/3 — Deploying implementation…" } }));
      const implReceipt = await sendAndWait(buildDeployImplementationTx());
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
        })
      );
      const proxyAddress = proxyReceipt.contractAddress as Address;
      if (!proxyAddress) throw new Error("No contractAddress in proxy deploy receipt");

      setPhase((p) => ({ ...p, [target.key]: { step: "albumBuyer", label: "3/3 — Deploying AlbumBuyer…" } }));
      const albumBuyerReceipt = await sendAndWait(buildDeployAlbumBuyerTx());
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
      const implReceipt = await sendAndWait(buildDeployImplementationTx());
      const newImplementationAddress = implReceipt.contractAddress as Address;
      if (!newImplementationAddress) throw new Error("No contractAddress in implementation deploy receipt");

      setPhase((p) => ({ ...p, [target.key]: { step: "upgrade", label: "2/2 — Calling upgradeToAndCall…" } }));
      await sendAndWait(buildUpgradeTx(target.address as Address, newImplementationAddress));

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
    try {
      await ensureChain(target);

      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        setPhase((p) => ({
          ...p,
          [target.key]: { step: "mint", label: `Minting "${track.title}" #1-10 (track ${i + 1}/${tracks.length})…` },
        }));
        await sendAndWait(buildAdminMintTx(target.address as Address, BigInt(track.index), BigInt(10), address as Address));
      }

      const nativeToken = getNativeTokenForChain(chainKey);
      const nativeUsd = await getTokenUsdPrice(nativeToken);
      if (!nativeUsd) {
        throw new Error(`Minted all editions, but could not price ${nativeToken.symbol} right now — try listing again shortly.`);
      }

      const editions = tracks.flatMap((track) =>
        Array.from({ length: 10 }, (_, e) => {
          const editionNumber = e + 1;
          const priceUsd = priceUsdForEdition(editionNumber);
          const priceWei = BigInt(Math.round((priceUsd / nativeUsd) * 1e18));
          return { tokenId: encodeTokenId(track.index, editionNumber), priceWei };
        })
      );

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
      await fetch("/api/listings", {
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
    try {
      await ensureChain(target);

      const owned = (await publicClient!.readContract({
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
      await fetch("/api/listings", {
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
    try {
      const umi = createSolanaAdminUmi(provider);
      const minted: SolanaMintRecord[] = [];

      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        const result = await deployTrackAndMintAdmin(
          umi,
          { trackId: track.index, title: track.title, collectionMint: target.address as string, editions: 100, priceLamports: 300000 },
          (label) => setPhase((p) => ({ ...p, solana: { step: "mint", label: `Track ${i + 1}/${tracks.length} — ${label}` } }))
        );
        for (const e of result.editions) {
          minted.push({ trackId: track.index, editionNumber: e.editionNumber, tokenId: e.tokenId, mint: e.mint, candyMachine: result.candyMachine });
        }
      }

      const nativeToken = getNativeTokenForChain("solana");
      const solUsd = await getTokenUsdPrice(nativeToken);
      if (!solUsd) throw new Error("Minted all editions, but could not price SOL right now — list again shortly.");

      const priced: SolanaMintRecord[] = minted.map((m) => ({
        ...m,
        listedPriceSol: priceUsdForEdition(m.editionNumber) / solUsd,
      }));

      setPhase((p) => ({ ...p, solana: { step: "list", label: `Listing ${priced.length} editions on Magic Eden…` } }));
      const connection = getConnection();
      const listResult = await listEditionsOnMagicEden(
        provider,
        connection,
        solWallet.address,
        priced.map((m) => ({ mint: m.mint, priceSol: m.listedPriceSol! })),
        (done, total) => setPhase((p) => ({ ...p, solana: { step: "list", label: `Listing on Magic Eden… ${done}/${total}` } }))
      );

      await fetch("/api/solana-mints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: address, mints: priced }),
      });

      if (listResult.failed.length > 0) console.error("Magic Eden listing failures:", listResult.failed);
      setPhase((p) => ({
        ...p,
        solana: {
          step: "done",
          label:
            listResult.failed.length > 0
              ? `Minted ${priced.length} editions across ${tracks.length} tracks. ${listResult.failed.length} Magic Eden listing(s) failed — see console.`
              : `Minted + listed ${priced.length} editions across ${tracks.length} tracks on Magic Eden.`,
        },
      }));
    } catch (err) {
      setPhase((p) => ({ ...p, solana: { step: "error", label: describeError(err) } }));
    }
  }

  async function handleSolanaReprice() {
    const provider = solWallet.getProvider();
    if (!provider || !solWallet.address) return;
    try {
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

      let listFailures = 0;
      if (notYetListed.length > 0) {
        setPhase((p) => ({ ...p, solana: { step: "reprice", label: `Listing ${notYetListed.length} not-yet-listed edition(s)…` } }));
        const listResult = await listEditionsOnMagicEden(
          provider,
          connection,
          solWallet.address,
          notYetListed.map((m) => ({ mint: m.mint, priceSol: priceUsdForEdition(m.editionNumber) / solUsd }))
        );
        listFailures = listResult.failed.length;
      }

      const updated: SolanaMintRecord[] = owned.map((m) => ({
        ...m,
        listedPriceSol: priceUsdForEdition(m.editionNumber) / solUsd,
      }));
      await fetch("/api/solana-mints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: address, mints: updated }),
      });

      const failures = repriceResult.failed.length + listFailures;
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
