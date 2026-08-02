import type { WalletClient, Address } from "viem";
import { createPublicClient, http } from "viem";
import { Seaport } from "@opensea/seaport-js";
import { ChainKey } from "./albums";
import { EVM_RPC_URLS, EVM_CHAINS } from "./dylSwap";
import { CONTRACT_TARGETS } from "./admin";
import { DylCollectionAbi, buildMintTx, buildAlbumBatchMintTx } from "./contractDeploy";
import { encodeTokenId } from "./tokenIdScheme";
import { viemWalletClientToEthersSigner } from "./ethersSigner";
import type { StoredListing } from "./siteListing";

/**
 * THE REAL FINAL PURCHASE STEP — the piece lib/payWithAnyToken.ts's own doc
 * comment explicitly defers to "the caller," which genuinely did not exist
 * anywhere in this codebase before this file (confirmed via a full
 * launch-readiness audit, 2026-08-02: nothing anywhere calls a real
 * mint()/AlbumBuyer.batchMint()/Seaport fulfillOrder for an NFT purchase —
 * the entire consumer buy flow is lib/holdings.ts's localStorage mock, and
 * BuyConfirmModal.tsx's "Confirm Buy" button calls setNotLive(true) instead
 * of ever reaching runPayWithAnyToken at all).
 *
 * NOT WIRED TO ANY LIVE BUTTON — same "build now, flip later" discipline
 * this codebase already uses for payWithAnyToken.ts itself. Wiring this in
 * requires, at minimum: (1) real contracts actually deployed on the target
 * chain (CONTRACT_TARGETS[chain].address populated), (2) replacing
 * BuyConfirmModal.tsx's setNotLive(true) with a real call into this module
 * after runPayWithAnyToken's currency-conversion leg completes, and (3) a
 * fresh explicit go-ahead from Dylan — this file existing does not itself
 * authorize going live, per the standing rule in CLAUDE.md ("dont actually
 * swap anything til we drop the real contracts").
 *
 * EVM CHAINS ONLY (Robinhood, Base, Ethereum). Solana purchases need a
 * completely different mechanism — a Candy Machine mintV2 call for a fresh
 * mint, or a Magic Eden buy instruction for a resale — neither of which is
 * built here. Calling this module for a Solana track purchase will throw
 * (see isEvmPurchaseChain below); that gap is real and should be closed
 * separately before Solana purchases can ever go live, not silently
 * papered over here.
 *
 * Verified the only way available in this environment: round-trip-decoding
 * every built transaction against the real ABI (no funded wallet, no
 * deployed contract to actually send against) — same discipline already
 * used throughout onchain/ and lib/contractDeploy.ts.
 */

export function isEvmPurchaseChain(chain: ChainKey): boolean {
  return chain === "robinhood" || chain === "base" || chain === "ethereum";
}

function deployedTarget(chain: ChainKey) {
  const target = CONTRACT_TARGETS.find((t) => t.key === chain);
  if (!target?.address || !target.chainId) {
    throw new Error(`No deployed collection contract for "${chain}" yet — CONTRACT_TARGETS[${chain}].address is still null.`);
  }
  return target as typeof target & { address: string; chainId: number };
}

function publicClientFor(chainId: number) {
  const chain = EVM_CHAINS[chainId as keyof typeof EVM_CHAINS];
  const rpcUrl = EVM_RPC_URLS[chainId];
  if (!chain || !rpcUrl) throw new Error(`No public RPC configured for chain ${chainId}.`);
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

/** Reads the deployed contract's LIVE mintPriceWei — never trust a cached/stale value for what to actually pay, the contract requires exact payment. */
export async function getLiveMintPriceWei(chain: ChainKey): Promise<bigint> {
  const target = deployedTarget(chain);
  const client = publicClientFor(target.chainId);
  return (await client.readContract({
    address: target.address as Address,
    abi: DylCollectionAbi,
    functionName: "mintPriceWei",
  })) as bigint;
}

export interface FulfillMintParams {
  chain: ChainKey;
  trackId: number;
  quantity: number;
  buyerAddress: Address;
  /** A wallet client already switched to the correct chain — same "fresh client, not the stale reactive hook value" requirement as every other real tx in this codebase (see ensureEvmChain patterns elsewhere). */
  walletClient: WalletClient;
}

/** Real, single-track primary mint — the "buy the next available edition" path (entry.type === "mint" in lib/orderbook.ts). */
export async function fulfillMintPurchase(params: FulfillMintParams): Promise<{ txHash: string }> {
  if (!isEvmPurchaseChain(params.chain)) throw new Error(`Solana purchases aren't supported by this module yet (chain: ${params.chain}).`);
  const target = deployedTarget(params.chain);
  const mintPriceWei = await getLiveMintPriceWei(params.chain);
  const valueWei = mintPriceWei * BigInt(params.quantity);
  const tx = buildMintTx(target.address as Address, BigInt(params.trackId), BigInt(params.quantity), params.buyerAddress, valueWei);
  const hash = await params.walletClient.sendTransaction({
    account: params.buyerAddress,
    to: tx.to,
    data: tx.data,
    value: tx.value,
    chain: null,
  });
  return { txHash: hash };
}

export interface FulfillAlbumMintParams {
  chain: ChainKey;
  trackIds: number[];
  quantities: number[];
  buyerAddress: Address;
  walletClient: WalletClient;
}

/** Real whole-album purchase — one signature across every track's own non-sequential tokenId range, via the deployed AlbumBuyer wrapper. */
export async function fulfillAlbumMintPurchase(params: FulfillAlbumMintParams): Promise<{ txHash: string }> {
  if (!isEvmPurchaseChain(params.chain)) throw new Error(`Solana purchases aren't supported by this module yet (chain: ${params.chain}).`);
  const target = deployedTarget(params.chain);
  if (!target.albumBuyerAddress) throw new Error(`No deployed AlbumBuyer for "${params.chain}" yet.`);
  const mintPriceWei = await getLiveMintPriceWei(params.chain);
  const quantities = params.quantities.map((q) => BigInt(q));
  const totalQuantity = quantities.reduce((sum, q) => sum + q, BigInt(0));
  const totalValueWei = mintPriceWei * totalQuantity;
  const tx = buildAlbumBatchMintTx({
    albumBuyerAddress: target.albumBuyerAddress as Address,
    collectionAddress: target.address as Address,
    trackIds: params.trackIds.map((id) => BigInt(id)),
    quantities,
    to: params.buyerAddress,
    totalValueWei,
  });
  const hash = await params.walletClient.sendTransaction({
    account: params.buyerAddress,
    to: tx.to,
    data: tx.data,
    value: tx.value,
    chain: null,
  });
  return { txHash: hash };
}

export interface FulfillResaleParams {
  chain: ChainKey;
  trackId: number;
  editionNumber: number;
  buyerAddress: Address;
  walletClient: WalletClient;
}

/**
 * Real resale purchase — fulfills our own site's 0%-fee Seaport order
 * (lib/siteListing.ts built it, this is the other half of that same
 * mechanism: taking a stored, already-signed order and actually executing
 * it on-chain). Deliberately fulfills the SITE-side order, not the
 * OpenSea-side one, since that's the 0%-fee half and this is our own buy
 * flow, not a purchase routed through opensea.io.
 */
export async function fulfillResalePurchase(params: FulfillResaleParams): Promise<{ txHash: string }> {
  if (!isEvmPurchaseChain(params.chain)) throw new Error(`Solana purchases aren't supported by this module yet (chain: ${params.chain}).`);
  const target = deployedTarget(params.chain);
  const tokenId = encodeTokenId(params.trackId, params.editionNumber);

  const res = await fetch(`/api/listings?chainId=${target.chainId}`);
  if (!res.ok) throw new Error(`Failed to load listings (status ${res.status}).`);
  const { listings } = (await res.json()) as { listings: StoredListing[] };
  const listing = listings.find(
    (l) => l.tokenId === tokenId && l.collectionAddress.toLowerCase() === (target.address as string).toLowerCase()
  );
  if (!listing) {
    throw new Error(`No active site listing found for edition #${params.editionNumber} of this track — it may already be sold.`);
  }

  const signer = await viemWalletClientToEthersSigner(params.walletClient);
  // Same ethers v6 dual-package-hazard cast lib/siteListing.ts and
  // lib/openSeaListing.ts already use — one physical `ethers` install, safe.
  const seaport = new Seaport(signer as unknown as ConstructorParameters<typeof Seaport>[0]);
  const useCase = await seaport.fulfillOrder({
    order: { parameters: listing.parameters, signature: listing.signature },
    accountAddress: params.buyerAddress,
  });
  // seaport-js's own .d.ts types this return as `ContractTransaction` (the
  // UNSENT request shape) for every exchange action, but its actual runtime
  // implementation (usecase.js) returns `transactionMethods.transact()`
  // directly for the final action — a real ethers ContractTransactionResponse
  // (has .hash), not an unsent request. Same category of narrow, documented
  // SDK-type-inaccuracy cast already used elsewhere in this codebase
  // (lib/siteListing.ts, lib/openSeaListing.ts) for this same package.
  const tx = (await useCase.executeAllActions()) as unknown as { hash: string };
  return { txHash: tx.hash };
}
