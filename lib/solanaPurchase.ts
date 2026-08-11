import { generateSigner, publicKey as toPublicKey, some } from "@metaplex-foundation/umi";
import { mintV2 } from "@metaplex-foundation/mpl-candy-machine";
import { TokenStandard } from "@metaplex-foundation/mpl-token-metadata";
import { setComputeUnitLimit } from "@metaplex-foundation/mpl-toolbox";
import { createSolanaAdminUmi, fetchCollectionUpdateAuthority } from "./solanaAdmin";
import { fulfillMagicEdenPurchase, type MeBuyInput } from "./magicEdenListing";
import { CONTRACT_TARGETS } from "./admin";
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

/**
 * Real public mint through a track's Candy Guard — the Solana counterpart
 * to lib/nftPurchase.ts's fulfillMintPurchase. `collectionUpdateAuthority`/
 * the guard's `solPayment.destination` are both the collection's real
 * on-chain update authority (fetchCollectionUpdateAuthority), not a
 * hardcoded wallet — there's no separate "Solana admin wallet" constant
 * anywhere in this codebase (a Solana pubkey is a completely different
 * address format from lib/admin.ts's EVM ADMIN_WALLET).
 */
export async function fulfillSolanaMintPurchase(params: FulfillSolanaMintParams): Promise<{ mint: string }> {
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
  return { mint: nftMint.publicKey.toString() };
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
