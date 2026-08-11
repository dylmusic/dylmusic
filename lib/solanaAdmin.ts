import { createUmi as createUmiCore } from "@metaplex-foundation/umi-bundle-defaults";
import { generateSigner, percentAmount, publicKey as toPublicKey, signerIdentity, some, none, sol, isSome, type Umi } from "@metaplex-foundation/umi";
import { createNft, mplTokenMetadata, TokenStandard, fetchDigitalAsset } from "@metaplex-foundation/mpl-token-metadata";
import {
  mplCandyMachine,
  createCandyMachineV2,
  addConfigLines,
  createCandyGuard,
  wrap,
  mintFromCandyMachineV2,
  findCandyGuardPda,
  fetchCandyGuard,
  updateCandyGuard,
  fetchCandyMachine,
} from "@metaplex-foundation/mpl-candy-machine";
import { setComputeUnitLimit } from "@metaplex-foundation/mpl-toolbox";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { SOLANA_RPC_URL, type PhantomProvider } from "./solana";
import { createPhantomUmiSigner } from "./solanaAdminSigner";
import type { SolanaMintRecord } from "./solanaMintsStore";

// Browser-signed port of onchain-solana/scripts/create-collection.ts and
// create-track-candy-machine.ts — same real, dry-run-proven instruction
// sequence (verified end-to-end against a local validator running real
// cloned mainnet Token Metadata + Candy Machine Core + Candy Guard
// programs), just signed by whoever's Phantom is connected in /admin
// instead of a local keypair file. Deliberately NOT re-derived from
// scratch: every instruction call here mirrors the proven script line for
// line, only the identity signer and the "collect results into an array
// instead of console.log" plumbing changed. Never exercised through a
// real Phantom prompt end-to-end in this environment (no funded wallet
// available in-session) — same category of gap already accepted
// throughout this codebase for every other real integration; dry-run on
// devnet before ever pointing this at mainnet-beta.

const METADATA_BASE = "https://dylmusic.vercel.app/api/metadata/solana/";
const MINT_COMPUTE_UNITS = 800_000; // Candy Machine mints routinely exceed the 200k default budget
const ADMIN_RESERVED_EDITIONS = 10;
const TOKEN_ID_STRIDE = 1000; // mirrors lib/tokenIdScheme.ts's EVM numbering exactly

export function createSolanaAdminUmi(provider: PhantomProvider): Umi {
  const umi = createUmiCore(SOLANA_RPC_URL).use(mplTokenMetadata()).use(mplCandyMachine());
  umi.use(signerIdentity(createPhantomUmiSigner(provider)));
  return umi;
}

// No signer needed for a plain account read — used by the real Solana
// order book (lib/realSolanaOrderBook.ts) to show accurate "remaining
// editions" without requiring a connected Phantom wallet first.
export function createReadOnlySolanaUmi(): Umi {
  return createUmiCore(SOLANA_RPC_URL).use(mplCandyMachine()).use(mplTokenMetadata());
}

/**
 * The Solana Collection NFT's real on-chain update authority — needed as
 * `collectionUpdateAuthority`/the guard's `solPayment` destination for a
 * real public mintV2 call (lib/solanaPurchase.ts). Read live rather than
 * hardcoded: unlike the EVM ADMIN_WALLET constant, there is no separate
 * "Solana admin wallet" constant anywhere in this codebase (a Solana
 * pubkey is a completely different address format), and guessing it
 * would be exactly the kind of unverified assumption this codebase avoids
 * elsewhere.
 */
export async function fetchCollectionUpdateAuthority(collectionMint: string): Promise<string> {
  const umi = createReadOnlySolanaUmi();
  const asset = await fetchDigitalAsset(umi, toPublicKey(collectionMint));
  return asset.metadata.updateAuthority.toString();
}

export interface TrackMintProgress {
  itemsAvailable: number;
  itemsRedeemed: number;
}

/** Real on-chain mint progress for one track's Candy Machine — itemsRedeemed/itemsAvailable, same account create-track-candy-machine.ts itself creates. */
export async function fetchTrackMintProgress(candyMachine: string): Promise<TrackMintProgress> {
  const umi = createReadOnlySolanaUmi();
  const account = await fetchCandyMachine(umi, toPublicKey(candyMachine));
  return {
    itemsAvailable: Number(account.data.itemsAvailable),
    itemsRedeemed: Number(account.itemsRedeemed),
  };
}

/**
 * Real LIVE guard price in lamports — reads the same `solPayment` field
 * `repriceCandyGuard` writes to, so the real order book stays consistent
 * with a real reprice action instead of showing the track's static
 * lib/albums.ts priceUsd forever regardless of what was actually repriced
 * on-chain. Returns null if the guard has no solPayment configured (would
 * mean minting is genuinely free/unguarded — not the case for any real
 * track this app creates, but not assumed either).
 */
export async function fetchTrackGuardPriceLamports(candyGuard: string): Promise<number | null> {
  const umi = createReadOnlySolanaUmi();
  const guard = await fetchCandyGuard(umi, toPublicKey(candyGuard));
  const sp = guard.guards.solPayment;
  if (!isSome(sp)) return null;
  return Number(sp.value.lamports.basisPoints);
}

/** Run exactly once, ever, per environment (devnet vs mainnet-beta are separate collections). */
export async function deploySolanaCollection(umi: Umi): Promise<{ mint: string }> {
  const collectionMint = generateSigner(umi);
  await createNft(umi, {
    mint: collectionMint,
    name: "Dyl",
    uri: `${METADATA_BASE}collection`,
    sellerFeeBasisPoints: percentAmount(6.9), // declared, not enforced — matches the EVM ERC-2981 default
    isCollection: true,
    collectionDetails: some({ __kind: "V1" as const, size: BigInt(0) }),
  }).sendAndConfirm(umi);
  return { mint: collectionMint.publicKey.toString() };
}

export interface SolanaTrackMintResult {
  candyMachine: string;
  candyGuard: string;
  editions: { editionNumber: number; tokenId: number; mint: string }[];
}

/**
 * Run once per track (new album/song = run again with a new trackId).
 * Creates a dedicated Candy Machine sized to the track's edition cap,
 * verified into the single Collection NFT, mints editions #1-10 straight
 * to the admin wallet (no guard, no payment — mintFromCandyMachineV2 talks
 * directly to CandyMachineCore and never touches CandyGuard, so this MUST
 * run before the guard is wrapped on below), then wraps a Candy Guard so
 * public/paid minting opens for edition #11 onward.
 */
export async function deployTrackAndMintAdmin(
  umi: Umi,
  params: { trackId: number; title: string; collectionMint: string; editions: number; priceLamports: number },
  onProgress?: (label: string) => void
): Promise<SolanaTrackMintResult> {
  const collectionMint = toPublicKey(params.collectionMint);
  const admin = umi.identity;

  onProgress?.(`Creating Candy Machine for "${params.title}"…`);
  const candyMachine = generateSigner(umi);
  await (
    await createCandyMachineV2(umi, {
    candyMachine,
    collectionMint,
    collectionUpdateAuthority: admin,
    itemsAvailable: BigInt(params.editions),
    symbol: "Dyl",
    sellerFeeBasisPoints: percentAmount(6.9),
    maxEditionSupply: BigInt(0),
    isMutable: true,
    creators: [{ address: admin.publicKey, verified: true, percentageShare: 100 }],
    configLineSettings: some({
      prefixName: `Dyl #`,
      nameLength: 6,
      prefixUri: METADATA_BASE,
      uriLength: 6, // tokenId strings for this scheme run up to 6 digits (trackId*1000+100)
      isSequential: true,
    }),
      hiddenSettings: none(),
      tokenStandard: TokenStandard.NonFungible,
    })
  ).sendAndConfirm(umi);

  onProgress?.(`Uploading ${params.editions} config lines…`);
  const tokenIds = Array.from({ length: params.editions }, (_, i) => params.trackId * TOKEN_ID_STRIDE + i + 1);
  const CHUNK = 20; // addConfigLines is limited by transaction size — batch in chunks, same as the proven script
  for (let i = 0; i < tokenIds.length; i += CHUNK) {
    const chunk = tokenIds.slice(i, i + CHUNK);
    await addConfigLines(umi, {
      candyMachine: candyMachine.publicKey,
      index: i,
      configLines: chunk.map((id) => ({ name: `${id}`, uri: `${id}` })),
    }).sendAndConfirm(umi);
  }

  onProgress?.(`Minting editions #1-${ADMIN_RESERVED_EDITIONS}…`);
  const editions: { editionNumber: number; tokenId: number; mint: string }[] = [];
  for (let i = 0; i < ADMIN_RESERVED_EDITIONS; i++) {
    const nftMint = generateSigner(umi);
    await setComputeUnitLimit(umi, { units: MINT_COMPUTE_UNITS })
      .add(
        mintFromCandyMachineV2(umi, {
          candyMachine: candyMachine.publicKey,
          mintAuthority: admin,
          nftOwner: admin.publicKey,
          nftMint,
          collectionMint,
          collectionUpdateAuthority: admin.publicKey,
        })
      )
      .sendAndConfirm(umi);
    editions.push({
      editionNumber: i + 1,
      tokenId: params.trackId * TOKEN_ID_STRIDE + i + 1,
      mint: nftMint.publicKey.toString(),
    });
  }

  onProgress?.("Opening public mint (wrapping Candy Guard)…");
  const candyGuardBase = generateSigner(umi);
  // The candy guard ACCOUNT is a PDA derived from `base` (findCandyGuardPda),
  // NOT the base signer's own address — every later reference must use this
  // derived PDA (a real bug hit and fixed in dry-run-devnet.ts).
  const candyGuardPda = findCandyGuardPda(umi, { base: candyGuardBase.publicKey });
  await createCandyGuard(umi, {
    base: candyGuardBase,
    guards: { solPayment: some({ lamports: sol(params.priceLamports / 1_000_000_000), destination: admin.publicKey }) },
  }).sendAndConfirm(umi);
  await wrap(umi, { candyGuard: candyGuardPda, candyMachine: candyMachine.publicKey }).sendAndConfirm(umi);

  return {
    candyMachine: candyMachine.publicKey.toString(),
    candyGuard: candyGuardPda[0].toString(),
    editions,
  };
}

/**
 * Re-pegs a single track's PUBLIC Solana mint price (the Candy Guard's
 * solPayment amount, editions #11+) — the Solana equivalent of
 * buildSetMintPriceTx/setMintPrice on the EVM side (lib/contractDeploy.ts).
 * Not the same thing as Magic Eden secondary-listing repricing
 * (repriceEditionsOnMagicEden in lib/magicEdenListing.ts, which changes
 * what an already-minted edition is FOR SALE at) — this changes what the
 * NEXT public mint costs.
 *
 * Real, callable at any time by the guard's own authority, not gated on
 * "nothing sold yet" — Metaplex's updateCandyGuard instruction just
 * overwrites the guard's stored config; any mint that already happened
 * keeps whatever it actually paid, every mint after this tx confirms
 * uses the new price. Fetches the guard's current config first and only
 * overrides `solPayment` (spreading every other guard/group through
 * unchanged) rather than blindly re-declaring a fresh guard set, since
 * updateCandyGuard replaces the ENTIRE stored config, not a partial patch
 * — silently dropping some future, currently-unused guard type here would
 * be a real, hard-to-notice regression.
 */
export async function repriceCandyGuard(
  umi: Umi,
  params: { candyGuard: string; newPriceLamports: number; destination: string }
): Promise<void> {
  const candyGuardPk = toPublicKey(params.candyGuard);
  const current = await fetchCandyGuard(umi, candyGuardPk);
  await updateCandyGuard(umi, {
    candyGuard: candyGuardPk,
    guards: {
      ...current.guards,
      solPayment: some({
        lamports: sol(params.newPriceLamports / 1_000_000_000),
        destination: toPublicKey(params.destination),
      }),
    },
    groups: current.groups,
  }).sendAndConfirm(umi);
}

/**
 * Mirrors the EVM Reprice & Relist flow's tokensOfOwner ownership check —
 * Solana has no on-chain "list everything this wallet owns from this
 * collection" call the way ERC721AQueryableUpgradeable does, so this
 * batch-checks each recorded mint's Associated Token Account directly
 * (getMultipleParsedAccounts, chunked to respect RPC batch limits) and
 * keeps only the ones the admin wallet still actually holds — anything
 * already sold on Magic Eden has transferred to the buyer's own ATA and
 * won't come back from this.
 */
export async function filterOwnedMints(
  connection: Connection,
  records: SolanaMintRecord[],
  owner: string
): Promise<SolanaMintRecord[]> {
  if (records.length === 0) return [];
  const ownerKey = new PublicKey(owner);
  const atas = await Promise.all(records.map((r) => getAssociatedTokenAddress(new PublicKey(r.mint), ownerKey)));
  const CHUNK = 100;
  const stillOwned: boolean[] = [];
  for (let i = 0; i < atas.length; i += CHUNK) {
    const chunk = atas.slice(i, i + CHUNK);
    const infos = await connection.getMultipleParsedAccounts(chunk);
    for (const info of infos.value) {
      const amount = (info?.data as { parsed?: { info?: { tokenAmount?: { uiAmount?: number } } } } | undefined)?.parsed?.info
        ?.tokenAmount?.uiAmount;
      stillOwned.push(!!amount && amount > 0);
    }
  }
  return records.filter((_, i) => stillOwned[i]);
}
