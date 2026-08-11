import { Seaport } from "@opensea/seaport-js";
import { ItemType } from "@opensea/seaport-js/lib/constants";
import type { OrderWithCounter } from "@opensea/seaport-js/lib/types";
import type { JsonRpcSigner } from "ethers";

// Our own site's resale listings — genuinely 0% fee, never expires. Built
// directly against Seaport's own SDK (the real, audited protocol OpenSea
// itself is built on), with NO fee tacked on and NO submission to OpenSea's
// API — that combination is exactly what keeps this side free. Confirmed by
// reading the installed SDK source directly before writing this: omitting
// `fees` means no extra consideration item gets added, and Seaport's own
// documented default for `endTime` (when left unset) is its own MAX_INT —
// "never end" — not a guess, that is the SDK's own doc comment and default
// value. This is a SEPARATE signed order from the one posted to OpenSea
// (see lib/openSeaListing.ts) for the same edition — a Seaport order's
// payout split is fixed at signing time, so one order cannot be "0% here,
// 1% there"; two valid orders for the same token is the real mechanism
// (locked in with Dylan — see CLAUDE.md "our own marketplace contract").

export interface EditionListingInput {
  collectionAddress: string;
  tokenId: number;
  priceWei: bigint;
  sellerAddress: string;
}

export interface StoredListing {
  chainId: number;
  collectionAddress: string;
  tokenId: number;
  priceWei: string;
  sellerAddress: string;
  parameters: OrderWithCounter["parameters"];
  signature: string;
  createdAt: number;
}

/**
 * Builds and signs one 0%-fee, non-expiring Seaport order per edition, all
 * under a single bulk EIP-712 signature (Seaport's own bulk-order feature —
 * without this, minting+listing 190 editions would mean 190 separate wallet
 * prompts just for this half of the flow). Returns the signed orders ready
 * to persist via POST /api/listings; does not touch Redis itself (this file
 * has to be importable from the client-side admin panel, where the signing
 * happens — Redis access stays server-only, same split as every other store
 * in this app, e.g. lib/chatStore.ts).
 */
export async function createSiteListings(
  signer: JsonRpcSigner,
  items: EditionListingInput[]
): Promise<OrderWithCounter[]> {
  if (items.length === 0) return [];
  // Same ethers v6 dual-package-hazard cast as lib/openSeaListing.ts — see
  // that file's comment for the full explanation. Safe: one physical
  // `ethers` install, same runtime object either way.
  const seaport = new Seaport(signer as unknown as ConstructorParameters<typeof Seaport>[0]);
  const offerer = await signer.getAddress();
  const inputs = items.map((item) => ({
    offer: [
      {
        itemType: ItemType.ERC721 as const,
        token: item.collectionAddress,
        identifier: item.tokenId.toString(),
      },
    ],
    consideration: [
      {
        amount: item.priceWei.toString(),
        recipient: item.sellerAddress,
      },
    ],
    // endTime intentionally omitted — defaults to Seaport's own MAX_INT
    // ("never end"), per the SDK's own documented behavior.
  }));
  // createBulkOrders handles any array length correctly (confirmed by
  // reading its source — it always uses Seaport's bulk-signature path,
  // with no special-casing needed for a single item), so this is the one
  // code path regardless of how many editions are being listed at once.
  const useCase = await seaport.createBulkOrders(inputs, offerer);
  return useCase.executeAllActions();
}

/**
 * Invalidates EVERY previously-signed Seaport order from this wallet on
 * whichever chain the signer is connected to, in one on-chain transaction
 * (Seaport's own `incrementCounter` — any order signed under the old
 * counter value stops verifying, permanently). This is the real mechanism
 * behind "reprice & relist": our own site's listings are signed to never
 * expire, so just signing new ones on top would leave the OLD (cheaper)
 * orders still fulfillable by anyone holding a cached copy. Since the
 * OpenSea-side listing for the same edition is also a Seaport order signed
 * by this same wallet (see lib/openSeaListing.ts), this one call
 * invalidates both halves of every past dual-listing at once — no separate
 * OpenSea-side cancel call needed.
 */
export async function cancelAllListings(signer: JsonRpcSigner): Promise<void> {
  const seaport = new Seaport(signer as unknown as ConstructorParameters<typeof Seaport>[0]);
  const offerer = await signer.getAddress();
  const tx = await seaport.bulkCancelOrders(offerer).transact();
  await tx.wait();
}

/**
 * Cancels ONE specific listing (Seaport-js's real per-order `cancel`,
 * verified in node_modules/@opensea/seaport-js/lib/seaport.js:334) — unlike
 * cancelAllListings' bulk incrementCounter, this leaves every OTHER
 * listing from the same wallet untouched. This is what a regular user's
 * own "Cancel" button (components/ListingsModal.tsx) needs — bulk-cancel
 * would also wipe out any other unrelated editions they have listed.
 *
 * Known real gap, not solved here: this only cancels our own site's
 * Seaport order. A dual-listed OpenSea order for the same edition
 * (lib/openSeaListing.ts createOpenSeaListings) is a SEPARATE signed
 * order with its own hash — cancelling this one does not cancel that one.
 * OpenSea's SDK doesn't currently expose a ready cancel-by-order-hash
 * method to call here (checked — see the "Real buy/sell" CLAUDE.md
 * section), so the OpenSea half stays listed until fulfillment fails
 * there (Seaport's own ownership check makes a second sale impossible,
 * just not instantly reflected on opensea.io) or its 6-month cap lapses.
 */
export async function cancelSiteListing(signer: JsonRpcSigner, orderParameters: StoredListing["parameters"]): Promise<void> {
  const seaport = new Seaport(signer as unknown as ConstructorParameters<typeof Seaport>[0]);
  const offerer = await signer.getAddress();
  const tx = await seaport.cancelOrders([orderParameters], offerer).transact();
  await tx.wait();
}
