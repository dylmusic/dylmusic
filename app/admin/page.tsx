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
  buildDeployAlbumBuyerImplementationTx,
  buildDeployAlbumBuyerProxyTx,
  buildUpgradeAlbumBuyerTx,
  buildSetMintPriceTx,
  buildSetEditionsPerTrackTx,
  buildSetClaimMinterTx,
  buildDeployBurnClaimRedeemerImplementationTx,
  buildDeployBurnClaimRedeemerProxyTx,
  buildUpgradeBurnClaimRedeemerTx,
  buildSetClaimSignerTx,
  buildRedeemerPauseTx,
  buildWithdrawTx,
} from "@/lib/contractDeploy";
import { wagmiConfig } from "@/lib/web3";
import { ALBUMS, type ChainKey } from "@/lib/albums";
import { getNativeTokenForChain } from "@/lib/dylTokens";
import { getTokenUsdPrice } from "@/lib/tokenUsdPrice";
import { priceUsdForEdition } from "@/lib/editionPricing";
import { encodeTokenId } from "@/lib/tokenIdScheme";
import { viemWalletClientToEthersSigner } from "@/lib/ethersSigner";
import { createSiteListings, cancelAllListings } from "@/lib/siteListing";
import { createOpenSeaListings, getOpenSeaSdk, isOpenSeaListable } from "@/lib/openSeaListing";
import { DylCollectionAbi } from "@/lib/contractDeploy";
import { useSolanaWallet, getConnection } from "@/lib/solana";
import { createSolanaAdminUmi, deploySolanaCollection, deployTrackAndMintAdmin, filterOwnedMints, repriceCandyGuard } from "@/lib/solanaAdmin";
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
        | "albumBuyerImplementation"
        | "albumBuyerProxy"
        | "newImplementation"
        | "upgrade"
        | "albumBuyerNewImplementation"
        | "albumBuyerUpgrade"
        | "burnRedeemerImplementation"
        | "burnRedeemerProxy"
        | "burnRedeemerGrant"
        | "burnRedeemerNewImplementation"
        | "burnRedeemerUpgrade"
        | "set-claim-signer"
        | "redeemer-pause"
        | "redeemer-unpause"
        | "mint"
        | "cancel"
        | "list-site"
        | "list-opensea"
        | "deploy"
        | "list"
        | "reprice"
        | "reprice-mint-price"
        | "set-editions-per-track"
        | "withdraw";
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
  const [editionsPerTrackInput, setEditionsPerTrackInput] = useState<Record<string, string>>({});
  // Destination address for pulling accumulated mint ETH out of the
  // collection contract's own balance — withdraw() has always existed
  // on-chain (DylCollection.sol, owner-only) but never had an admin-panel
  // button wired to it (Dylan: "you never gave me the withdrawal button").
  const [withdrawToInput, setWithdrawToInput] = useState<Record<string, string>>({});
  const [contractEthBalance, setContractEthBalance] = useState<Record<string, bigint>>({});
  // The dedicated burn-claim signing key's PUBLIC address only — generate
  // the keypair separately (never in the browser), save the PRIVATE half
  // to Vercel as BURN_CLAIM_SIGNER_PRIVATE_KEY (server-only), paste the
  // public address here before deploying. Deliberately never the admin
  // wallet — see BurnClaimRedeemer.sol's doc comment.
  const [claimSignerInput, setClaimSignerInput] = useState<Record<string, string>>({});

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

  // Live "how much is actually sitting there to withdraw" — mint ETH just
  // accumulates in each collection contract's own balance (see
  // DylCollection.sol's `mint()`, no auto-forwarding anywhere), so this is
  // the real number the Withdraw button below is about to move, not an
  // estimate.
  async function loadContractBalances() {
    const results = await Promise.all(
      targets
        .filter((t) => t.address && t.chainId)
        .map(async (t) => {
          try {
            const client = getPublicClient(wagmiConfig, { chainId: t.chainId! });
            const bal = await client!.getBalance({ address: t.address as Address });
            return [t.key, bal] as const;
          } catch {
            return null;
          }
        })
    );
    setContractEthBalance((prev) => {
      const next = { ...prev };
      for (const r of results) if (r) next[r[0]] = r[1];
      return next;
    });
  }

  useEffect(() => {
    if (allowed) void loadContractBalances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          symbol: "Dyl",
          admin: address as Address,
          initialMintPriceWei: DEFAULT_MINT_PRICE_WEI,
          initialMetadataBaseURI: metadataBaseURI(target.key),
        }),
        target.chainId!
      );
      const proxyAddress = proxyReceipt.contractAddress as Address;
      if (!proxyAddress) throw new Error("No contractAddress in proxy deploy receipt");

      setPhase((p) => ({
        ...p,
        [target.key]: { step: "albumBuyerImplementation", label: "3/4 — Deploying AlbumBuyer implementation…" },
      }));
      const albumBuyerImplReceipt = await sendAndWait(buildDeployAlbumBuyerImplementationTx(), target.chainId!);
      const albumBuyerImplementationAddress = albumBuyerImplReceipt.contractAddress as Address;
      if (!albumBuyerImplementationAddress) throw new Error("No contractAddress in AlbumBuyer implementation deploy receipt");

      setPhase((p) => ({
        ...p,
        [target.key]: { step: "albumBuyerProxy", label: "4/4 — Deploying AlbumBuyer proxy…" },
      }));
      const albumBuyerProxyReceipt = await sendAndWait(
        buildDeployAlbumBuyerProxyTx({
          implementationAddress: albumBuyerImplementationAddress,
          admin: address as Address,
        }),
        target.chainId!
      );
      const albumBuyerAddress = albumBuyerProxyReceipt.contractAddress as Address;

      setTargetField(target.key, {
        address: proxyAddress,
        implementationAddress,
        albumBuyerAddress: albumBuyerAddress ?? null,
        albumBuyerImplementationAddress: albumBuyerAddress ? albumBuyerImplementationAddress : null,
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

  async function handleUpgradeAlbumBuyer(target: ContractTarget) {
    if (!target.albumBuyerAddress) return;
    try {
      await ensureChain(target);
      setPhase((p) => ({
        ...p,
        [target.key]: { step: "albumBuyerNewImplementation", label: "1/2 — Deploying new AlbumBuyer implementation…" },
      }));
      const implReceipt = await sendAndWait(buildDeployAlbumBuyerImplementationTx(), target.chainId!);
      const newImplementationAddress = implReceipt.contractAddress as Address;
      if (!newImplementationAddress) throw new Error("No contractAddress in AlbumBuyer implementation deploy receipt");

      setPhase((p) => ({
        ...p,
        [target.key]: { step: "albumBuyerUpgrade", label: "2/2 — Calling upgradeToAndCall on AlbumBuyer…" },
      }));
      await sendAndWait(
        buildUpgradeAlbumBuyerTx(target.albumBuyerAddress as Address, newImplementationAddress),
        target.chainId!
      );

      setTargetField(target.key, { albumBuyerImplementationAddress: newImplementationAddress });
      setPhase((p) => ({
        ...p,
        [target.key]: {
          step: "done",
          label: `AlbumBuyer upgraded. New implementation ${truncate(newImplementationAddress)}.`,
        },
      }));
    } catch (err) {
      setPhase((p) => ({ ...p, [target.key]: { step: "error", label: describeError(err) } }));
    }
  }

  // Deploys BurnClaimRedeemer (implementation + proxy) for this chain, then
  // immediately grants it claimMinters permission on the ALREADY-deployed
  // collection (target.address must exist first — this is the on-chain
  // half of burn-and-mint, see CLAUDE.md / the burn-and-mint plan). Bundled
  // into one flow (unlike AlbumBuyer, which needs no such grant — its
  // batchMint just calls the normal public payable mint()) since a
  // redeemer that can't yet call claimMint isn't actually usable.
  async function handleDeployBurnClaimRedeemer(target: ContractTarget) {
    if (!address || !target.address) return;
    const claimSigner = claimSignerInput[target.key]?.trim();
    if (!claimSigner || !claimSigner.startsWith("0x") || claimSigner.length !== 42) {
      setPhase((p) => ({
        ...p,
        [target.key]: { step: "error", label: "Paste a real claim-signer PUBLIC address (0x…40 hex chars) first — see the note below." },
      }));
      return;
    }
    try {
      await ensureChain(target);

      setPhase((p) => ({
        ...p,
        [target.key]: { step: "burnRedeemerImplementation", label: "1/3 — Deploying BurnClaimRedeemer implementation…" },
      }));
      const implReceipt = await sendAndWait(buildDeployBurnClaimRedeemerImplementationTx(), target.chainId!);
      const implementationAddress = implReceipt.contractAddress as Address;
      if (!implementationAddress) throw new Error("No contractAddress in BurnClaimRedeemer implementation deploy receipt");

      setPhase((p) => ({
        ...p,
        [target.key]: { step: "burnRedeemerProxy", label: "2/3 — Deploying BurnClaimRedeemer proxy…" },
      }));
      const proxyReceipt = await sendAndWait(
        buildDeployBurnClaimRedeemerProxyTx({
          implementationAddress,
          admin: address as Address,
          claimSigner: claimSigner as Address,
        }),
        target.chainId!
      );
      const redeemerAddress = proxyReceipt.contractAddress as Address;
      if (!redeemerAddress) throw new Error("No contractAddress in BurnClaimRedeemer proxy deploy receipt");

      setPhase((p) => ({
        ...p,
        [target.key]: { step: "burnRedeemerGrant", label: "3/3 — Granting claimMinters on the collection…" },
      }));
      await sendAndWait(buildSetClaimMinterTx(target.address as Address, redeemerAddress, true), target.chainId!);

      setTargetField(target.key, {
        burnClaimRedeemerAddress: redeemerAddress,
        burnClaimRedeemerImplementationAddress: implementationAddress,
        claimSignerAddress: claimSigner,
      });
      setPhase((p) => ({
        ...p,
        [target.key]: {
          step: "done",
          label: `Deployed & granted. Redeemer ${truncate(redeemerAddress)} — commit this into lib/admin.ts CONTRACT_TARGETS.`,
        },
      }));
    } catch (err) {
      setPhase((p) => ({ ...p, [target.key]: { step: "error", label: describeError(err) } }));
    }
  }

  async function handleUpgradeBurnClaimRedeemer(target: ContractTarget) {
    if (!target.burnClaimRedeemerAddress) return;
    try {
      await ensureChain(target);
      setPhase((p) => ({
        ...p,
        [target.key]: { step: "burnRedeemerNewImplementation", label: "1/2 — Deploying new BurnClaimRedeemer implementation…" },
      }));
      const implReceipt = await sendAndWait(buildDeployBurnClaimRedeemerImplementationTx(), target.chainId!);
      const newImplementationAddress = implReceipt.contractAddress as Address;
      if (!newImplementationAddress) throw new Error("No contractAddress in BurnClaimRedeemer implementation deploy receipt");

      setPhase((p) => ({
        ...p,
        [target.key]: { step: "burnRedeemerUpgrade", label: "2/2 — Calling upgradeToAndCall on BurnClaimRedeemer…" },
      }));
      await sendAndWait(
        buildUpgradeBurnClaimRedeemerTx(target.burnClaimRedeemerAddress as Address, newImplementationAddress),
        target.chainId!
      );

      setTargetField(target.key, { burnClaimRedeemerImplementationAddress: newImplementationAddress });
      setPhase((p) => ({
        ...p,
        [target.key]: {
          step: "done",
          label: `BurnClaimRedeemer upgraded. New implementation ${truncate(newImplementationAddress)}.`,
        },
      }));
    } catch (err) {
      setPhase((p) => ({ ...p, [target.key]: { step: "error", label: describeError(err) } }));
    }
  }

  // Rotates the on-chain claimSigner — use immediately if the dedicated
  // signing key is ever suspected leaked. Takes effect instantly; every
  // voucher signed with the OLD key stops verifying the moment this lands.
  async function handleSetClaimSigner(target: ContractTarget) {
    if (!target.burnClaimRedeemerAddress) return;
    const newSigner = claimSignerInput[target.key]?.trim();
    if (!newSigner || !newSigner.startsWith("0x") || newSigner.length !== 42) {
      setPhase((p) => ({ ...p, [target.key]: { step: "error", label: "Paste the new claim-signer PUBLIC address first." } }));
      return;
    }
    try {
      await ensureChain(target);
      setPhase((p) => ({ ...p, [target.key]: { step: "set-claim-signer", label: "Rotating claimSigner…" } }));
      await sendAndWait(buildSetClaimSignerTx(target.burnClaimRedeemerAddress as Address, newSigner as Address), target.chainId!);
      setTargetField(target.key, { claimSignerAddress: newSigner });
      setPhase((p) => ({ ...p, [target.key]: { step: "done", label: `claimSigner rotated to ${truncate(newSigner)}.` } }));
    } catch (err) {
      setPhase((p) => ({ ...p, [target.key]: { step: "error", label: describeError(err) } }));
    }
  }

  // Emergency kill switch — pausing blocks every claim() call immediately
  // without touching the collection or its claimMinters grant at all.
  async function handleRedeemerPause(target: ContractTarget, pause: boolean) {
    if (!target.burnClaimRedeemerAddress) return;
    try {
      await ensureChain(target);
      setPhase((p) => ({
        ...p,
        [target.key]: { step: pause ? "redeemer-pause" : "redeemer-unpause", label: pause ? "Pausing claims…" : "Unpausing claims…" },
      }));
      await sendAndWait(buildRedeemerPauseTx(target.burnClaimRedeemerAddress as Address, pause), target.chainId!);
      setPhase((p) => ({ ...p, [target.key]: { step: "done", label: pause ? "Claims paused." : "Claims unpaused." } }));
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
        // Wrapped separately from the mint + site-listing steps above,
        // which are already durable at this point: @opensea/sdk's own
        // createBulkListings builds every listing's pricing/currency
        // metadata in a single plain loop with NO per-item try/catch —
        // `continueOnError` only covers the later order-submission step,
        // so one bad currency lookup (seen live: a brand-new collection's
        // `pricingCurrencies.listingCurrency` reporting 6 decimals instead
        // of the correct 18 for native ETH, throwing "Too many decimal
        // places: 18 > 6" via their own parseUnits) aborts the ENTIRE call
        // with zero partial results. Without this try/catch, that SDK-level
        // throw would propagate to the outer catch below and report the
        // whole run as failed — hiding the fact that minting and our own
        // 0%-fee site listings already genuinely succeeded. OpenSea listing
        // is a bonus on top of the site listing, not a mint blocker.
        try {
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
        } catch (openSeaErr) {
          openSeaFailures = editions.length;
          console.error(`OpenSea listing call itself failed for ${target.chainName} (mint + site listings still succeeded):`, openSeaErr);
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
      // tokensOfOwner (ERC721AQueryable's enumeration helper) reverts with
      // NotCompatibleWithSpotMints() on this contract — every mint here
      // lands at a computed tokenId (trackId * STRIDE + edition), which
      // ERC721A's own enumeration explicitly refuses to support once any
      // non-sequential ("spot") mint has happened, which is every mint
      // this contract ever does. Confirmed via a real deploy+mint+read on
      // Robinhood Chain 2026-08-12, not assumed from the ABI. Fix: compute
      // the #1-10 candidate tokenIds ourselves (same math the contract
      // itself uses) and check ownerOf directly instead of enumerating.
      const candidates = ALBUMS.flatMap((a) => a.tracks).flatMap((t) =>
        Array.from({ length: 10 }, (_, i) => ({ tokenId: encodeTokenId(t.index, i + 1), trackId: t.index, editionNumber: i + 1 }))
      );
      const owners = await Promise.all(
        candidates.map((c) =>
          freshReadClient!
            .readContract({
              address: target.address as Address,
              abi: DylCollectionAbi,
              functionName: "ownerOf",
              args: [BigInt(c.tokenId)],
            })
            .catch(() => null) as Promise<Address | null>
        )
      );
      const editions = candidates.filter((_, i) => owners[i]?.toLowerCase() === (address as string).toLowerCase());

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

  // Editions-per-track cap is admin-settable storage now (2026-08-11) —
  // unlike setMintPrice's live USD re-peg, there's no "correct" derived
  // value here, it's a business decision, so this reads a plain admin-typed
  // number instead. See DylCollection.sol for why this one is safe to make
  // mutable while TOKEN_ID_STRIDE/ADMIN_RESERVED_EDITIONS are not.
  async function handleSetEditionsPerTrack(target: ContractTarget) {
    if (!target.address || !target.chainId) return;
    const raw = editionsPerTrackInput[target.key];
    const newCap = raw ? Number(raw) : NaN;
    if (!Number.isInteger(newCap) || newCap <= 0) {
      setPhase((p) => ({ ...p, [target.key]: { step: "error", label: "Enter a positive whole number first." } }));
      return;
    }
    setPhase((p) => ({ ...p, [target.key]: { step: "set-editions-per-track", label: `Setting editions/track to ${newCap}…` } }));
    try {
      await ensureChain(target);
      await sendAndWait(buildSetEditionsPerTrackTx(target.address as Address, BigInt(newCap)), target.chainId!);
      setPhase((p) => ({
        ...p,
        [target.key]: { step: "done", label: `Editions per track set to ${newCap}.` },
      }));
    } catch (err) {
      setPhase((p) => ({ ...p, [target.key]: { step: "error", label: describeError(err) } }));
    }
  }

  // Pulls the collection contract's ENTIRE current ETH balance out in one
  // call (withdraw() has no partial-amount param — see DylCollection.sol).
  // Defaults the destination to the connected admin wallet itself if the
  // input's left blank, rather than forcing a paste for the common case.
  async function handleWithdraw(target: ContractTarget) {
    if (!target.address || !target.chainId || !address) return;
    const to = (withdrawToInput[target.key]?.trim() || address) as Address;
    if (!to.startsWith("0x") || to.length !== 42) {
      setPhase((p) => ({ ...p, [target.key]: { step: "error", label: "That doesn't look like a valid 0x… address." } }));
      return;
    }
    setPhase((p) => ({ ...p, [target.key]: { step: "withdraw", label: `Withdrawing to ${truncate(to)}…` } }));
    try {
      await ensureChain(target);
      await sendAndWait(buildWithdrawTx(target.address as Address, to), target.chainId!);
      setPhase((p) => ({ ...p, [target.key]: { step: "done", label: `Withdrawn to ${truncate(to)}.` } }));
      void loadContractBalances();
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
          candyGuard: result.candyGuard,
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

  // Re-pegs each track's PUBLIC Solana mint price (Candy Guard solPayment,
  // editions #11+) to the current $0.99 USD target at the live SOL rate —
  // the Solana counterpart to handleRepriceMintPrice on the EVM chains
  // above. Distinct from handleSolanaReprice just above, which reprices
  // already-minted #1-10 editions' SECONDARY Magic Eden listings, not the
  // ongoing public mint price. One Phantom prompt per track that has a
  // recorded candyGuard (tracks minted before this feature shipped have no
  // candyGuard on their records and are skipped, same "can't target what
  // wasn't recorded" limit noted on SolanaMintRecord.candyGuard).
  async function handleSolanaRepriceMintPrice() {
    const provider = solWallet.getProvider();
    if (!provider || !solWallet.address) return;
    setPhase((p) => ({ ...p, solana: { step: "reprice-mint-price", label: "Starting…" } }));
    try {
      const nativeToken = getNativeTokenForChain("solana");
      const solUsd = await getTokenUsdPrice(nativeToken);
      if (!solUsd) throw new Error("Could not price SOL right now — try again shortly.");

      const res = await fetch("/api/solana-mints");
      const { mints } = (await res.json()) as { mints: SolanaMintRecord[] };
      const guardByTrack = new Map<number, string>();
      for (const m of mints) {
        if (m.candyGuard && !guardByTrack.has(m.trackId)) guardByTrack.set(m.trackId, m.candyGuard);
      }
      if (guardByTrack.size === 0) {
        setPhase((p) => ({
          ...p,
          solana: { step: "done", label: "No tracks with a recorded Candy Guard to reprice yet." },
        }));
        return;
      }

      const umi = createSolanaAdminUmi(provider);
      const tracks = ALBUMS.flatMap((a) => a.tracks).filter((t) => guardByTrack.has(t.index));
      let done = 0;
      for (const track of tracks) {
        const candyGuard = guardByTrack.get(track.index)!;
        const newPriceLamports = Math.round((track.priceUsd / solUsd) * 1_000_000_000);
        setPhase((p) => ({
          ...p,
          solana: { step: "reprice-mint-price", label: `Repricing "${track.title}" (${done + 1}/${tracks.length})…` },
        }));
        await repriceCandyGuard(umi, { candyGuard, newPriceLamports, destination: solWallet.address });
        done++;
      }

      setPhase((p) => ({
        ...p,
        solana: { step: "done", label: `Re-pegged ${done} track(s) to $${PUBLIC_MINT_USD} at the current SOL rate.` },
      }));
    } catch (err) {
      setPhase((p) => ({ ...p, solana: { step: "error", label: describeError(err) } }));
    }
  }

  // One-click "reprice everything to the current USD peg" — Dylan's own
  // stated workflow going forward ("I'll do it from my wallet... make sure
  // we have controls to easily reprice all the mints"), so this exists
  // specifically to make a periodic manual check-in a single click instead
  // of visiting every chain row separately (3 EVM clicks + the Solana
  // per-track button). Runs the exact same per-chain handlers already
  // used by the individual "Reprice Mint Price" buttons, just in sequence
  // — each one already swallows its own errors into that chain's phase
  // state instead of throwing, so one chain's RPC hiccup or a rejected
  // wallet prompt doesn't stop the rest from running.
  const [repriceAllRunning, setRepriceAllRunning] = useState(false);
  async function handleRepriceAllMintPrices() {
    if (repriceAllRunning) return;
    setRepriceAllRunning(true);
    try {
      const evmTargets = targets.filter(
        (t) => (t.key === "robinhood" || t.key === "base" || t.key === "ethereum") && !!t.address
      );
      for (const t of evmTargets) {
        await handleRepriceMintPrice(t);
      }
      const solanaTarget = targets.find((t) => t.key === "solana");
      if (solanaTarget?.address && solWallet.address) {
        await handleSolanaRepriceMintPrice();
      }
    } finally {
      setRepriceAllRunning(false);
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
              <button
                className="admin-refresh"
                disabled={repriceAllRunning || !targets.some((t) => !!t.address)}
                title={`One click instead of visiting every chain row — re-pegs the ongoing public mint price to $${PUBLIC_MINT_USD} at the current rate on every deployed chain (EVM chains' setMintPrice, then Solana's per-track Candy Guard reprice). Does NOT touch the #1-10 secondary-listing prices — use each row's own "Reprice & Relist" for that.`}
                onClick={handleRepriceAllMintPrices}
              >
                {repriceAllRunning ? "Repricing…" : "Reprice Mint Price — All Chains"}
              </button>
            </div>
            <div className="admin-empty" style={{ marginBottom: 14 }}>
              One upgradable collection contract per chain — every track/album mints onto the
              existing contract as a new tokenId, never a new contract. ERC721A, not ERC-1155
              (decided 2026-07-28). See CLAUDE.md &quot;Contract Requirement&quot; before writing any
              of these. Steps 1–4 are required; step 5 (marketplace) is optional — only do it if
              OpenSea&apos;s own listing flow (Seaport) turns out not to be enough. Deploy also
              deploys that chain&apos;s AlbumBuyer wrapper (itself UUPS-upgradeable now too, same
              proxy pattern) in the same 4-transaction flow. Solana
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
                      {c.burnClaimRedeemerAddress && (
                        <div className="admin-contract-addr">
                          BurnClaimRedeemer: {c.burnClaimRedeemerAddress} (claimSigner: {c.claimSignerAddress})
                        </div>
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
                          disabled={busy(c.key) || !c.albumBuyerAddress}
                          title="Deploys a new AlbumBuyer implementation and calls upgradeToAndCall on the existing AlbumBuyer proxy — same UUPS pattern as the collection's own Upgrade button, just for the album-batch-mint wrapper."
                          onClick={() => handleUpgradeAlbumBuyer(c)}
                        >
                          Upgrade AlbumBuyer
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
                        <input
                          className="admin-contract-input"
                          type="number"
                          min={1}
                          step={1}
                          placeholder="New editions/track"
                          disabled={busy(c.key) || !c.address}
                          value={editionsPerTrackInput[c.key] ?? ""}
                          onChange={(e) => setEditionsPerTrackInput((prev) => ({ ...prev, [c.key]: e.target.value }))}
                        />
                        <button
                          className="admin-contract-btn"
                          disabled={busy(c.key) || !c.address || !editionsPerTrackInput[c.key]}
                          title="Changes the per-track edition cap (starts at 100) — a single tx, no upgrade needed, unlike TOKEN_ID_STRIDE/ADMIN_RESERVED_EDITIONS which stay fixed constants (see DylCollection.sol for why)."
                          onClick={() => handleSetEditionsPerTrack(c)}
                        >
                          Set Editions/Track
                        </button>
                        <span className="admin-contract-optional-tag" title="Live balance sitting in the collection contract right now">
                          {contractEthBalance[c.key] !== undefined
                            ? `${(Number(contractEthBalance[c.key]) / 1e18).toFixed(4)} ${getNativeTokenForChain(c.key as ChainKey).symbol} to withdraw`
                            : "…"}
                        </span>
                        <input
                          className="admin-contract-input"
                          type="text"
                          placeholder={`Withdraw to (blank = ${address ? truncate(address) : "your wallet"})`}
                          disabled={busy(c.key) || !c.address}
                          value={withdrawToInput[c.key] ?? ""}
                          onChange={(e) => setWithdrawToInput((prev) => ({ ...prev, [c.key]: e.target.value }))}
                        />
                        <button
                          className="admin-contract-btn"
                          disabled={busy(c.key) || !c.address}
                          title="Pulls the collection contract's ENTIRE current ETH balance out to the address above (or your own connected wallet if left blank) — owner-only, no partial-amount option on-chain."
                          onClick={() => handleWithdraw(c)}
                        >
                          Withdraw ETH
                        </button>
                        <input
                          className="admin-contract-input"
                          type="text"
                          placeholder="Claim-signer public address (0x…)"
                          disabled={busy(c.key) || !c.address}
                          value={claimSignerInput[c.key] ?? ""}
                          onChange={(e) => setClaimSignerInput((prev) => ({ ...prev, [c.key]: e.target.value }))}
                        />
                        <button
                          className="admin-contract-btn"
                          disabled={busy(c.key) || !c.address || !!c.burnClaimRedeemerAddress}
                          title="Deploys BurnClaimRedeemer (the on-chain half of burn-and-mint) and grants it claimMint permission on this collection in one flow. Generate a DEDICATED keypair first (never the admin wallet) — save its private key to Vercel as BURN_CLAIM_SIGNER_PRIVATE_KEY, paste its public address in the box to the left."
                          onClick={() => handleDeployBurnClaimRedeemer(c)}
                        >
                          Deploy Burn Redeemer
                        </button>
                        <button
                          className="admin-contract-btn"
                          disabled={busy(c.key) || !c.burnClaimRedeemerAddress}
                          title="Deploys a new BurnClaimRedeemer implementation and calls upgradeToAndCall on the existing redeemer proxy — same UUPS pattern as the collection's own Upgrade button."
                          onClick={() => handleUpgradeBurnClaimRedeemer(c)}
                        >
                          Upgrade Burn Redeemer
                        </button>
                        <button
                          className="admin-contract-btn"
                          disabled={busy(c.key) || !c.burnClaimRedeemerAddress || !claimSignerInput[c.key]}
                          title="Rotates the on-chain claimSigner to the address in the box to the left — use immediately if the dedicated signing key is ever suspected leaked. Every voucher signed with the old key stops verifying instantly."
                          onClick={() => handleSetClaimSigner(c)}
                        >
                          Rotate Claim Signer
                        </button>
                        <button
                          className="admin-contract-btn"
                          disabled={busy(c.key) || !c.burnClaimRedeemerAddress}
                          title="Emergency kill switch — immediately blocks every claim() call without touching the collection or its claimMinters grant."
                          onClick={() => handleRedeemerPause(c, true)}
                        >
                          Pause Claims
                        </button>
                        <button
                          className="admin-contract-btn"
                          disabled={busy(c.key) || !c.burnClaimRedeemerAddress}
                          onClick={() => handleRedeemerPause(c, false)}
                        >
                          Unpause Claims
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
                        <button
                          className="admin-contract-btn"
                          disabled={busy(c.key) || !c.address || !solWallet.address}
                          title={`Re-pegs the ONGOING public mint price (editions #11+) for every recorded track to $${PUBLIC_MINT_USD} at the current SOL rate via each track's own Candy Guard — the Solana counterpart to "Reprice Mint Price" on the EVM chains. One Phantom prompt per track. Distinct from "Reprice & Relist" above, which only touches already-minted #1-10 editions' Magic Eden listings, not the public mint price.`}
                          onClick={handleSolanaRepriceMintPrice}
                        >
                          Reprice Mint Price
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
