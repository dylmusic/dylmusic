import { createPublicClient, http, type Address } from "viem";
import { ALBUMS, ChainKey, Track } from "./albums";
import { EVM_RPC_URLS, EVM_CHAINS } from "./dylSwap";
import { CONTRACT_TARGETS } from "./admin";
import { DylCollectionAbi } from "./contractDeploy";
import { getNativeTokenForChain } from "./dylTokens";
import { getTokenUsdPrice } from "./tokenUsdPrice";
import { decodeTokenId, encodeTokenId } from "./tokenIdScheme";
import type { StoredListing } from "./siteListing";
import { isOpenSeaListable } from "./openSeaListing";
import type { OrderBookEntry } from "./orderbook";
import { OpenSeaSDK, type Listing } from "@opensea/sdk";

// Real, merged order-book data for a deployed EVM chain — see
// dylmusic/CLAUDE.md "Real buy/sell" for the full picture. Nothing here
// touches localStorage; every number is either read live on-chain or
// fetched from a real listings source (our own Redis-backed site listings,
// or OpenSea's own live order book). Only ever called for a chain whose
// CONTRACT_TARGETS entry has a real deployed `address` — callers are
// responsible for falling back to the simulated lib/orderbook.ts behavior
// otherwise (every chain, today).

export interface RealListing {
  source: "site" | "opensea";
  chainId: number;
  collectionAddress: string;
  tokenId: number;
  trackId: number;
  editionNumber: number;
  priceWei: bigint;
  priceUsd: number;
  sellerAddress: string;
  /** The exact object the matching fulfill call needs — StoredListing for "site", OpenSea's Listing for "opensea". */
  raw: StoredListing | Listing;
}

function target(chainKey: ChainKey) {
  const t = CONTRACT_TARGETS.find((c) => c.key === chainKey);
  if (!t?.address || !t.chainId) return null;
  return t as typeof t & { address: string; chainId: number };
}

function publicClientFor(chainId: number) {
  const chain = EVM_CHAINS[chainId as keyof typeof EVM_CHAINS];
  const rpcUrl = EVM_RPC_URLS[chainId];
  if (!chain || !rpcUrl) throw new Error(`No public RPC configured for chain ${chainId}.`);
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

// OpenSea's collection slug isn't the same as our on-chain name/symbol and
// isn't knowable ahead of time — resolved lazily via api.getNFT on any real
// tokenId we already know about (same mechanism lib/openSeaListing.ts's
// own createOpenSeaListings already relies on internally via
// _buildListingOrder -> api.getNFT -> nft.collection). Cached in memory per
// session since a collection's slug never changes once assigned. Requires a
// real OpenSeaSDK instance (a signer, even though this call is read-only —
// the SDK has no signer-less constructor) — callers without a connected
// wallet simply can't resolve the slug yet, which is fine pre-connect.
const slugCache = new Map<number, string>();

async function resolveOpenSeaSlugWithSdk(
  sdk: OpenSeaSDK,
  chainId: number,
  collectionAddress: string,
  knownTokenId: number
): Promise<string | null> {
  if (slugCache.has(chainId)) return slugCache.get(chainId)!;
  try {
    const { nft } = await sdk.api.getNFT(collectionAddress, String(knownTokenId));
    const slug = nft.collection;
    if (slug) slugCache.set(chainId, slug);
    return slug ?? null;
  } catch {
    // Brand-new collection OpenSea hasn't indexed yet, or the known tokenId
    // doesn't actually exist there — real, expected pre-launch state, not
    // an error worth surfacing to a page render.
    return null;
  }
}

// Field paths verified against @opensea/api-types' real schema, not
// guessed: Listing.protocolData is seaport-js's own OrderWithCounter
// (.parameters.offer[0].identifierOrCriteria is the tokenId,
// .parameters.offerer is the seller), and Listing.price.current.value is
// the raw smallest-unit amount as a decimal string. `.value` is only
// treated as wei here because every listing this app creates is priced in
// the chain's native currency (18 decimals) — a real ERC20-denominated
// third-party listing would need `price.current.decimals` respected too,
// out of scope for now since we never create one.
function normalizeOpenSeaListing(chainId: number, collectionAddress: string, listing: Listing, nativeUsd: number): RealListing | null {
  const tokenIdStr = listing.protocolData?.parameters?.offer?.[0]?.identifierOrCriteria;
  if (!tokenIdStr) return null;
  const tokenId = Number(tokenIdStr);
  const { trackId, editionNumber } = decodeTokenId(tokenId);
  const priceWei = BigInt(listing.price?.current?.value ?? "0");
  const priceUsd = (Number(priceWei) / 1e18) * nativeUsd;
  const sellerAddress = listing.protocolData?.parameters?.offerer ?? "";
  return { source: "opensea", chainId, collectionAddress, tokenId, trackId, editionNumber, priceWei, priceUsd, sellerAddress, raw: listing };
}

/**
 * Real, merged secondary-market listings for a whole deployed collection —
 * our own site's Redis-backed listings plus OpenSea's live order book
 * (anyone's listing, not just ones created through /admin). One paginated
 * sweep per source per call, not per-track — a track-scoped view is just a
 * filter over this.
 */
export async function fetchRealEvmListings(
  chainKey: ChainKey,
  sdkForSlugLookup: OpenSeaSDK | null
): Promise<RealListing[]> {
  const t = target(chainKey);
  if (!t) return [];
  const nativeToken = getNativeTokenForChain(chainKey);
  const nativeUsd = (await getTokenUsdPrice(nativeToken)) ?? 0;

  const siteRes = await fetch(`/api/listings?chainId=${t.chainId}`);
  const siteData = await siteRes.json().catch(() => ({ listings: [] as StoredListing[] }));
  const siteListings: StoredListing[] = siteData?.listings ?? [];
  const site: RealListing[] = siteListings.map((l) => {
    const { trackId, editionNumber } = decodeTokenId(l.tokenId);
    const priceWei = BigInt(l.priceWei);
    return {
      source: "site",
      chainId: t.chainId,
      collectionAddress: t.address,
      tokenId: l.tokenId,
      trackId,
      editionNumber,
      priceWei,
      priceUsd: (Number(priceWei) / 1e18) * nativeUsd,
      sellerAddress: l.sellerAddress,
      raw: l,
    };
  });

  let openSea: RealListing[] = [];
  if (isOpenSeaListable(chainKey) && sdkForSlugLookup) {
    // Bootstrap the slug from any real tokenId we already know about — the
    // first site listing if one exists. If nothing is listed on our own
    // site yet, there's nothing meaningful to cross-reference on OpenSea
    // either yet (a brand-new, never-listed collection).
    const bootstrapTokenId = siteListings[0]?.tokenId;
    const slug = bootstrapTokenId
      ? await resolveOpenSeaSlugWithSdk(sdkForSlugLookup, t.chainId, t.address, bootstrapTokenId)
      : null;
    if (slug) {
      let next: string | undefined;
      const all: Listing[] = [];
      do {
        const page = await sdkForSlugLookup.api.getAllListings(slug, 100, next);
        all.push(...page.listings);
        next = page.next;
      } while (next);
      openSea = all
        .map((l) => normalizeOpenSeaListing(t.chainId, t.address, l, nativeUsd))
        .filter((l): l is RealListing => l !== null);
    }
  }

  return [...site, ...openSea];
}

/**
 * Real on-chain ownership. NOT ERC721AQueryableUpgradeable's `tokensOfOwner`
 * — confirmed via a real deploy+mint+read on Robinhood Chain (2026-08-12)
 * that it reverts with `NotCompatibleWithSpotMints()` on this contract:
 * every mint here lands at a computed tokenId (trackId * STRIDE + edition,
 * see tokenIdScheme.ts), which ERC721A's own enumeration helper explicitly
 * refuses to support once any non-sequential ("spot") mint has happened —
 * which is every mint this contract ever does. Instead, for each known
 * track, read how many editions have actually minted (`nextEditionIndex`)
 * and check `ownerOf` directly against each computed tokenId in that
 * range — the same math the contract itself uses, just walked from our
 * side instead of asking the contract to enumerate. Replaces
 * `lib/holdings.ts`'s simulated per-wallet localStorage ledger once a
 * chain is deployed — real ownership, not a browser-local record.
 */
export async function fetchRealOwnedTokenIds(chainKey: ChainKey, owner: string): Promise<number[]> {
  const t = target(chainKey);
  if (!t) return [];
  const client = publicClientFor(t.chainId);
  const tracks = ALBUMS.flatMap((a) => a.tracks);
  const owned: number[] = [];
  await Promise.all(
    tracks.map(async (track) => {
      const minted = Number(
        (await client.readContract({
          address: t.address as Address,
          abi: DylCollectionAbi,
          functionName: "nextEditionIndex",
          args: [BigInt(track.index)],
        })) as bigint
      );
      if (minted === 0) return;
      const tokenIds = Array.from({ length: minted }, (_, i) => encodeTokenId(track.index, i + 1));
      const owners = await Promise.all(
        tokenIds.map((tokenId) =>
          client.readContract({
            address: t.address as Address,
            abi: DylCollectionAbi,
            functionName: "ownerOf",
            args: [BigInt(tokenId)],
          }) as Promise<Address>
        )
      );
      owners.forEach((o, i) => {
        if (o.toLowerCase() === owner.toLowerCase()) owned.push(tokenIds[i]);
      });
    })
  );
  return owned;
}

export interface RealMintRow {
  priceWei: bigint;
  priceUsd: number;
  remaining: number;
}

/** Real on-chain read of a track's live mint price + remaining editions — replaces the simulated baselineMinted/localMintedCount math once a chain is deployed. */
export async function fetchRealMintRow(chainKey: ChainKey, track: Track): Promise<RealMintRow | null> {
  const t = target(chainKey);
  if (!t) return null;
  const client = publicClientFor(t.chainId);
  const [nextEditionIndex, editionsPerTrack, mintPriceWei] = await Promise.all([
    client.readContract({ address: t.address as Address, abi: DylCollectionAbi, functionName: "nextEditionIndex", args: [BigInt(track.index)] }) as Promise<bigint>,
    client.readContract({ address: t.address as Address, abi: DylCollectionAbi, functionName: "editionsPerTrack" }) as Promise<bigint>,
    client.readContract({ address: t.address as Address, abi: DylCollectionAbi, functionName: "mintPriceWei" }) as Promise<bigint>,
  ]);
  const remaining = Number(editionsPerTrack - nextEditionIndex);
  if (remaining <= 0) return { priceWei: mintPriceWei, priceUsd: 0, remaining: 0 };
  const nativeToken = getNativeTokenForChain(chainKey);
  const nativeUsd = (await getTokenUsdPrice(nativeToken)) ?? 0;
  const priceUsd = (Number(mintPriceWei) / 1e18) * nativeUsd;
  return { priceWei: mintPriceWei, priceUsd, remaining };
}

/** Combines the real mint row + real merged listings for ONE track into the same OrderBookEntry[] shape lib/orderbook.ts's simulated buildOrderBook already produces. */
export async function buildRealOrderBook(
  chainKey: ChainKey,
  track: Track,
  allListings: RealListing[]
): Promise<OrderBookEntry[]> {
  const entries: OrderBookEntry[] = [];
  const mintRow = await fetchRealMintRow(chainKey, track);
  if (mintRow && mintRow.remaining > 0) {
    entries.push({ type: "mint", priceUsd: mintRow.priceUsd, remaining: mintRow.remaining });
  }
  for (const l of allListings) {
    if (l.trackId !== track.index) continue;
    entries.push({
      type: "resale",
      priceUsd: l.priceUsd,
      editionNumber: l.editionNumber,
      seller: l.sellerAddress,
      source: l.source,
      chainId: l.chainId,
      collectionAddress: l.collectionAddress,
      tokenId: l.tokenId,
      sellerAddress: l.sellerAddress,
      raw: l.raw,
    });
  }
  return entries.sort((a, b) => a.priceUsd - b.priceUsd);
}
