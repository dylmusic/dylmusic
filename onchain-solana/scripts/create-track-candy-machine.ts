// Run ONCE PER TRACK (new album/song = run this again with a new --track-id)
// — creates a dedicated Candy Machine sized to that track's edition cap,
// verified into the single Collection NFT from create-collection.ts, mints
// editions #1-10 directly to the admin wallet (no guard, no payment — see
// the module comment below for why this ordering is what makes that free),
// then wraps a Candy Guard so public/paid minting opens for edition #11
// onward. Mirrors onchain/contracts/DylCollection.sol's mint(trackId, ...)
// design and lib/tokenIdScheme.ts's exact tokenId numbering
// (trackId*1000+editionIndex+1), so the SAME app/api/metadata/[chain]/[tokenId]
// route serves both chains' metadata unchanged.
//
// Run with your own wallet, e.g.:
//   RPC_URL=https://api.mainnet-beta.solana.com \
//   KEYPAIR_PATH=~/.config/solana/id.json \
//   npx ts-node scripts/create-track-candy-machine.ts \
//     --track-id 1 --title "My Life" --collection-mint <from create-collection.ts> \
//     --editions 100 --price-lamports 300000
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createSignerFromKeypair,
  generateSigner,
  signerIdentity,
  percentAmount,
  publicKey as toPublicKey,
  some,
  none,
  sol,
} from "@metaplex-foundation/umi";
import { mplTokenMetadata, TokenStandard } from "@metaplex-foundation/mpl-token-metadata";
import {
  mplCandyMachine,
  createCandyMachineV2,
  addConfigLines,
  createCandyGuard,
  wrap,
  mintFromCandyMachineV2,
  findCandyGuardPda,
} from "@metaplex-foundation/mpl-candy-machine";
import { setComputeUnitLimit } from "@metaplex-foundation/mpl-toolbox";

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const KEYPAIR_PATH = (process.env.KEYPAIR_PATH ?? "~/.config/solana/id.json").replace(/^~/, os.homedir());
const METADATA_BASE = "https://dylmusic.vercel.app/api/metadata/solana/";
const MINT_COMPUTE_UNITS = 800_000; // Candy Machine mints routinely exceed the 200k default budget
const ADMIN_RESERVED_EDITIONS = 10;
const TOKEN_ID_STRIDE = 1000;

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const trackId = Number(argValue("--track-id"));
  const title = argValue("--title");
  const collectionMintAddress = argValue("--collection-mint");
  const editions = Number(argValue("--editions") ?? "100");
  const priceLamports = Number(argValue("--price-lamports") ?? "300000"); // ~$0.99-equivalent placeholder, tune manually

  if (!Number.isInteger(trackId) || !title || !collectionMintAddress) {
    console.error("Usage: --track-id <n> --title \"<song title>\" --collection-mint <address> [--editions 100] [--price-lamports 300000]");
    process.exit(1);
  }

  const umi = createUmi(RPC_URL).use(mplTokenMetadata()).use(mplCandyMachine());
  const secretKey = new Uint8Array(JSON.parse(fs.readFileSync(path.resolve(KEYPAIR_PATH), "utf8")));
  const adminKeypair = umi.eddsa.createKeypairFromSecretKey(secretKey);
  const admin = createSignerFromKeypair(umi, adminKeypair);
  umi.use(signerIdentity(admin));

  console.log(`RPC: ${RPC_URL}`);
  console.log(`Admin: ${admin.publicKey}`);
  console.log(`Track ${trackId} "${title}" — ${editions} editions, ${priceLamports} lamports/edition after #${ADMIN_RESERVED_EDITIONS}`);

  const collectionMint = toPublicKey(collectionMintAddress);

  // 1. Raw (unwrapped) Candy Machine — sized exactly to this track's cap.
  const candyMachine = generateSigner(umi);
  await (
    await createCandyMachineV2(umi, {
      candyMachine,
      collectionMint,
      collectionUpdateAuthority: admin,
      itemsAvailable: BigInt(editions),
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
  console.log(`✓ candy machine created: ${candyMachine.publicKey}`);

  // 2. Config lines — same trackId*1000+editionIndex+1 numbering as EVM.
  const tokenIds = Array.from({ length: editions }, (_, i) => trackId * TOKEN_ID_STRIDE + i + 1);
  // addConfigLines is limited by transaction size — batch in chunks.
  const CHUNK = 20;
  for (let i = 0; i < tokenIds.length; i += CHUNK) {
    const chunk = tokenIds.slice(i, i + CHUNK);
    await addConfigLines(umi, {
      candyMachine: candyMachine.publicKey,
      index: i,
      configLines: chunk.map((id) => ({ name: `${id}`, uri: `${id}` })),
    }).sendAndConfirm(umi);
  }
  console.log(`✓ uploaded ${tokenIds.length} config lines (tokenIds ${tokenIds[0]}..${tokenIds[tokenIds.length - 1]})`);

  // 3. Editions #1-10 direct to admin — mintFromCandyMachineV2 talks straight
  // to CandyMachineCore, never touching CandyGuard, so there's no guard to
  // pay/pass yet. Must run before step 4 wraps a guard on top.
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
  }
  console.log(`✓ minted editions 1-${ADMIN_RESERVED_EDITIONS} to admin wallet, no guard, no payment`);

  // 4. Wrap with a Candy Guard — public/paid minting opens from here for
  // edition ADMIN_RESERVED_EDITIONS+1 onward.
  const candyGuardBase = generateSigner(umi);
  const candyGuardPda = findCandyGuardPda(umi, { base: candyGuardBase.publicKey });
  await createCandyGuard(umi, {
    base: candyGuardBase,
    guards: { solPayment: some({ lamports: sol(priceLamports / 1_000_000_000), destination: admin.publicKey }) },
  }).sendAndConfirm(umi);
  await wrap(umi, { candyGuard: candyGuardPda, candyMachine: candyMachine.publicKey }).sendAndConfirm(umi);
  console.log(`✓ candy guard wrapped: ${candyGuardPda[0]} — public mint now live at ${priceLamports} lamports/edition`);

  console.log(`\nTrack ${trackId} ("${title}") fully set up.`);
  console.log(`Candy Machine: ${candyMachine.publicKey}`);
  console.log(`Candy Guard: ${candyGuardPda[0]}`);
  console.log(`Record both addresses — same convention as lib/admin.ts CONTRACT_TARGETS for the EVM chains.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
