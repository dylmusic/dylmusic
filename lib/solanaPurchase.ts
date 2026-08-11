import { generateSigner, publicKey as toPublicKey, some } from "@metaplex-foundation/umi";
import { mintV2 } from "@metaplex-foundation/mpl-candy-machine";
import { TokenStandard, fetchDigitalAsset } from "@metaplex-foundation/mpl-token-metadata";
import { setComputeUnitLimit } from "@metaplex-foundation/mpl-toolbox";
import { createSolanaAdminUmi, fetchCollectionUpdateAuthority } from "./solanaAdmin";
import { fulfillMagicEdenPurchase, type MeBuyInput } from "./magicEdenListing";
import { CONTRACT_TARGETS } from "./admin";
import { decodeTokenId } from "./tokenIdScheme";
import type { PhantomProvider } from "./solana";
import type { Connection } from "@solana/web3.js";

// Real Solana purchase engine — the counterpart to lib/nftPurchase.ts
// (EVM-only). Same verification discipline: every account/param below was
// read from the real onchain-solana/scripts/dry-run-devnet.ts sequence
// (which itself ran against real cloned mainnet programs on a local
// validator) or the installed mpl-candy-machine package's own types, not
// guessed. Never exercised through a real Phantom prompt in this
// environment (no funded wallet available in-session) — same category of
// gap already accepted throughout this codebase.
//
// createSolanaAdminUmi's name is legacy from the admin panel — it just
// wraps whichever Phantom is connected as the umi identity, real for any
// buyer, not admin-only.

const MINT_COMPUTE_UNITS = 800_000; // Candy Machine mints routinely exceed the 200k default budget

export interface FulfillSolanaMintParams {
  provider: PhantomProvider;
  candyMachine: string;
  candyGuard: string;
}

export interface SolanaMintResult {
  mint: string;
  tokenId: number;
  trackId: number;
  editionNumber: number;
}

/**
 * Real public mint through a track's Candy Guard — the Solana counterpart
 * to lib/nftPurchase.ts's fulfillMintPurchase. `collectionUpdateAuthority`/
 * the guard's `solPayment.destination` are both the collection's real
 * on-chain update authority (fetchCollectionUpdateAuthority), not a
 * hardcoded wallet — there's no separate "Solana admin wallet" constant
 * anywhere in this codebase (a Solana pubkey is a completely different
 * address format from lib/admin.ts's EVM ADMIN_WALLET).
 *
 * Returns the real tokenId the Candy Machine actually assigned, read back
 * from the freshly minted NFT's own on-chain metadata URI (config lines
 * were uploaded as `uri: "<tokenId>"`, same lib/tokenIdScheme.ts numbering
 * — see lib/solanaAdmin.ts's deployTrackAndMintAdmin) rather than assumed
 * from `isSequential` — this is what lets a fresh public mint be recorded
 * into SolanaMintsStore (see useTrackCommerce.ts) so it can be resold
 * later, same as an admin-premint edition already can.
 */
export async function fulfillSolanaMintPurchase(params: FulfillSolanaMintParams): Promise<SolanaMintResult> {
  const target = CONTRACT_TARGETS.find((t) => t.key === "solana");
  if (!target?.address) throw new Error("No deployed Solana collection yet.");
  const updateAuthority = await fetchCollectionUpdateAuthority(target.address);

  const umi = createSolanaAdminUmi(params.provider);
  const nftMint = generateSigner(umi);
  await setComputeUnitLimit(umi, { units: MINT_COMPUTE_UNITS })
    .add(
      mintV2(umi, {
        candyMachine: toPublicKey(params.candyMachine),
        candyGuard: toPublicKey(params.candyGuard),
        nftMint,
        collectionMint: toPublicKey(target.address),
        collectionUpdateAuthority: toPublicKey(updateAuthority),
        tokenStandard: TokenStandard.NonFungible,
        mintArgs: { solPayment: some({ destination: toPublicKey(updateAuthority) }) },
      })
    )
    .sendAndConfirm(umi);

  const asset = await fetchDigitalAsset(umi, nftMint.publicKey);
  const tokenIdStr = asset.metadata.uri.split("/").filter(Boolean).pop() ?? "";
  const tokenId = Number(tokenIdStr);
  if (!Number.isInteger(tokenId) || tokenId <= 0) {
    throw new Error(`Minted successfully but could not parse a real tokenId from the on-chain URI (${asset.metadata.uri}).`);
  }
  const { trackId, editionNumber } = decodeTokenId(tokenId);
  return { mint: nftMint.publicKey.toString(), tokenId, trackId, editionNumber };
}

export interface FulfillSolanaResaleParams {
  provider: PhantomProvider;
  connection: Connection;
  buyerAddress: string;
  listing: MeBuyInput;
}

/** Real resale purchase — thin wrapper around lib/magicEdenListing.ts's fulfillMagicEdenPurchase, kept here so every real Solana purchase (mint or resale) has one shared entry point matching lib/nftPurchase.ts's EVM shape. */
export async function fulfillSolanaResalePurchase(params: FulfillSolanaResaleParams): Promise<{ signature: string }> {
  const signature = await fulfillMagicEdenPurchase(params.provider, params.connection, params.listing);
  return { signature };
}
