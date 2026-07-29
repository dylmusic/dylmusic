import { OpenSeaSDK, Chain } from "@opensea/sdk";
import type { Listing } from "@opensea/sdk";
import { formatEther } from "ethers";
import type { JsonRpcSigner } from "ethers";
import { robinhoodChain } from "./web3";
import { base, mainnet } from "wagmi/chains";
import type { ChainKey } from "./albums";

// The OpenSea-side half of a dual listing (see lib/siteListing.ts for the
// 0%-fee half) — real OpenSea marketplace fee (their own SDK adds it
// automatically, we never compute or embed the percentage ourselves), and
// actually visible on opensea.io since it's submitted through their own
// Order Posting API rather than just signed and held.
//
// Confirmed live by reading the installed SDK source before writing this:
// - Chain.Robinhood === "robinhood" — the real chain slug OpenSea uses,
//   not a guess (their own package.json/enum, not scraped from a web page).
// - createListing/createBulkListings default to only a ONE MONTH
//   expiration if you do not pass one explicitly (`expirationTime ??
//   oneMonthFromNowInSeconds()`), and OpenSea's platform hard-caps any
//   listing at 6 months maximum (their own documented limit) — "never
//   expire" is genuinely not possible on this side. Dylan's call: set every
//   OpenSea listing to the max allowed (6 months) and renew manually later,
//   rather than building an auto-renewal job now.
// - `amount` is a DECIMAL string (e.g. "0.05" for 0.05 ETH), NOT wei — the
//   SDK's own price-parameter callback runs `parseUnits(amount, 18)`
//   internally. Passing wei directly here would overprice by 10^18.

const SIX_MONTHS_SECONDS = 6 * 30 * 24 * 60 * 60;

const OPENSEA_CHAIN_FOR_KEY: Partial<Record<ChainKey, Chain>> = {
  robinhood: Chain.Robinhood,
  base: Chain.Base,
  ethereum: Chain.Mainnet,
};

const CHAIN_ID_FOR_KEY: Partial<Record<ChainKey, number>> = {
  robinhood: robinhoodChain.id,
  base: base.id,
  ethereum: mainnet.id,
};

export function openSeaChainForKey(chainKey: ChainKey): Chain | null {
  return OPENSEA_CHAIN_FOR_KEY[chainKey] ?? null;
}

export function isOpenSeaListable(chainKey: ChainKey): boolean {
  return openSeaChainForKey(chainKey) !== null;
}

function getOpenSeaApiKey(): string {
  const key = process.env.NEXT_PUBLIC_OPENSEA_API_KEY;
  if (!key) {
    throw new Error(
      "NEXT_PUBLIC_OPENSEA_API_KEY is not set — request a key at docs.opensea.io and add it to the environment before listing on OpenSea."
    );
  }
  return key;
}

export function getOpenSeaSdk(signer: JsonRpcSigner, chainKey: ChainKey): OpenSeaSDK {
  const chain = openSeaChainForKey(chainKey);
  if (!chain) throw new Error(`OpenSea listings are not supported for chain "${chainKey}" (Solana has no Seaport).`);
  // @opensea/sdk ships its own compiled .d.ts referencing ethers' CJS
  // build, while this project's "moduleResolution": "bundler" resolves our
  // own `ethers` import through its ESM build — a real, well-known ethers
  // v6 dual-package-hazard (same physical class at runtime, two structurally
  // distinct types at compile time). The cast is safe: it is the exact same
  // `ethers` package (confirmed one physical install, `node_modules/ethers`,
  // not a duplicated nested copy) and the exact same object at runtime.
  return new OpenSeaSDK(signer as unknown as ConstructorParameters<typeof OpenSeaSDK>[0], {
    chain,
    apiKey: getOpenSeaApiKey(),
  });
}

export interface OpenSeaEditionListingInput {
  collectionAddress: string;
  tokenId: number;
  priceWei: bigint;
  sellerAddress: string;
}

/**
 * Submits one real listing per edition to OpenSea's own Order Posting API,
 * via their own bulk-listing helper (one signature covers the whole batch,
 * each listing still submitted individually with built-in rate-limit
 * handling — their own SDK's documented behavior, not something hand-rolled
 * here). Every listing expires in exactly 6 months (OpenSea's own maximum)
 * and will need re-listing after that — tracked as a manual admin action,
 * not automated.
 */
export async function createOpenSeaListings(
  sdk: OpenSeaSDK,
  items: OpenSeaEditionListingInput[]
): Promise<{ successful: Listing[]; failed: Array<{ index: number; error: Error }> }> {
  if (items.length === 0) return { successful: [], failed: [] };
  const expirationTime = Math.floor(Date.now() / 1000) + SIX_MONTHS_SECONDS;
  const result = await sdk.createBulkListings({
    accountAddress: items[0].sellerAddress,
    continueOnError: true,
    listings: items.map((item) => ({
      asset: { tokenAddress: item.collectionAddress, tokenId: item.tokenId.toString() },
      amount: formatEther(item.priceWei),
      expirationTime,
    })),
  });
  return {
    successful: result.successful,
    failed: result.failed.map((f) => ({ index: f.index, error: f.error })),
  };
}

export { CHAIN_ID_FOR_KEY as OPENSEA_EVM_CHAIN_ID_FOR_KEY };
