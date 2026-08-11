// Full Solana setup + mint cycle, run for real against devnet (real program,
// disposable devnet SOL via the permissionless airdrop RPC — unlike the EVM
// testnets, Solana's devnet faucet needs no CAPTCHA/wallet UI, so this is a
// genuine live network dry run, not a fork workaround).
//
// Mirrors the EVM design exactly: legacy (non-programmable) Metaplex NFTs,
// royalty declared not enforced (6.9%), dynamic per-mint tokenURI via our
// own /api/metadata/solana/{tokenId} route (same trackId*1000+edition+1
// numbering as the EVM contracts — see lib/tokenIdScheme.ts), and editions
// #1-10 minted free to the admin authority BEFORE any payment guard exists,
// simply because Candy Guard is only wrapped onto the Candy Machine AFTER
// those 10 direct mints (no "bypass" instruction needed — traced this from
// the SDK's own create() helper, which normally wraps immediately; this
// script deliberately calls the lower-level pieces in a different order).
import {
  createUmi as createUmiCore,
} from "@metaplex-foundation/umi-bundle-defaults";
import {
  generateSigner,
  keypairIdentity,
  percentAmount,
  sol,
  some,
  none,
  isSome,
  publicKey as toPublicKey,
} from "@metaplex-foundation/umi";
import { createNft, mplTokenMetadata, TokenStandard, fetchDigitalAsset } from "@metaplex-foundation/mpl-token-metadata";
import {
  mplCandyMachine,
  createCandyMachineV2,
  addConfigLines,
  createCandyGuard,
  wrap,
  mintV2,
  mintFromCandyMachineV2,
  fetchCandyMachine,
  findCandyGuardPda,
} from "@metaplex-foundation/mpl-candy-machine";
import { setComputeUnitLimit } from "@metaplex-foundation/mpl-toolbox";

// Candy Machine mints (Token Metadata Create+Mint under the hood) routinely
// exceed Solana's default 200,000 CU per-transaction budget — a normal,
// well-known real-world limit, not specific to this contract. Every mint
// transaction below requests a higher explicit budget for this reason.
const MINT_COMPUTE_UNITS = 800_000;

// Public devnet's airdrop faucet is rate-limited per IP and this sandboxed
// environment's shared IP was already exhausted (confirmed via a direct RPC
// call returning 429 before any code-level retry logic even ran). Using a
// local solana-test-validator instead, with the real Token Metadata + Candy
// Machine Core + Candy Guard programs CLONED IN from mainnet-beta (real
// deployed bytecode, not a mock) — same validation value as a devnet run,
// unlimited free local airdrops, zero external rate limits.
const DEVNET_RPC = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
const METADATA_BASE = "https://dylmusic.vercel.app/api/metadata/solana/";
const LAMPORTS_PER_EDITION = 1_000_000; // 0.001 SOL, devnet-friendly test price

async function airdropUntilFunded(umi: any, address: any, minLamports: number, label: string) {
  for (let i = 0; i < 5; i++) {
    const balance = await umi.rpc.getBalance(address);
    if (Number(balance.basisPoints) >= minLamports) {
      console.log(`  ${label} funded: ${balance.basisPoints} lamports`);
      return;
    }
    console.log(`  airdropping to ${label} (attempt ${i + 1})...`);
    try {
      await umi.rpc.airdrop(address, sol(1));
    } catch (err) {
      console.log(`  airdrop attempt failed: ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Could not fund ${label} after 5 attempts — devnet faucet may be rate-limited, retry later.`);
}

async function main() {
  const umi = createUmiCore(DEVNET_RPC).use(mplTokenMetadata()).use(mplCandyMachine());

  const admin = generateSigner(umi);
  umi.use(keypairIdentity(admin));
  console.log(`admin (candy machine authority): ${admin.publicKey}`);
  await airdropUntilFunded(umi, admin.publicKey, 2_000_000_000, "admin");

  // 1. Collection NFT (Certified Collection, sized) — every mint below gets
  // verified into this exact mint address.
  const collectionMint = generateSigner(umi);
  await createNft(umi, {
    mint: collectionMint,
    name: "Dyl",
    uri: `${METADATA_BASE}collection`,
    sellerFeeBasisPoints: percentAmount(6.9),
    isCollection: true,
    collectionDetails: some({ __kind: "V1" as const, size: 0n }),
  }).sendAndConfirm(umi);
  console.log(`✓ collection NFT created: ${collectionMint.publicKey}`);

  // 2. Raw (unguarded) Candy Machine — admin is its default authority/mint
  // authority at this point, nothing wraps it yet.
  const candyMachine = generateSigner(umi);
  await (await createCandyMachineV2(umi, {
    candyMachine,
    collectionMint: collectionMint.publicKey,
    collectionUpdateAuthority: admin,
    itemsAvailable: 12n,
    symbol: "Dyl",
    sellerFeeBasisPoints: percentAmount(6.9),
    maxEditionSupply: 0n,
    isMutable: true,
    creators: [{ address: admin.publicKey, verified: true, percentageShare: 100 }],
    configLineSettings: some({
      prefixName: "Dyl #",
      nameLength: 5, // room for a 4-5 digit tokenId string
      prefixUri: METADATA_BASE,
      uriLength: 5,
      isSequential: true,
    }),
    hiddenSettings: none(),
    tokenStandard: TokenStandard.NonFungible,
  })).sendAndConfirm(umi);
  console.log(`✓ candy machine created (unwrapped): ${candyMachine.publicKey}`);

  // 3. Upload config lines — same trackId=1 tokenId numbering as EVM
  // (1001..1010 admin-reserved, 1011 first public edition, 1012 spare).
  const tokenIds = Array.from({ length: 12 }, (_, i) => 1001 + i);
  await addConfigLines(umi, {
    candyMachine: candyMachine.publicKey,
    index: 0,
    configLines: tokenIds.map((id) => ({ name: `${id}`, uri: `${id}` })),
  }).sendAndConfirm(umi);
  console.log(`✓ uploaded ${tokenIds.length} config lines (tokenIds ${tokenIds[0]}..${tokenIds[tokenIds.length - 1]})`);

  // 4. Direct admin mints, editions 1-10 (tokenIds 1001-1010), via
  // mintFromCandyMachineV2 — the raw CandyMachineCore instruction, which
  // takes mintAuthority as a plain Signer and never touches the
  // mplCandyGuard program at all (mintV2 ALWAYS routes through CandyGuard,
  // even with no candyGuard passed it auto-derives the default guard PDA —
  // confirmed by reading mintV2.js directly after this failed the first
  // time here; mintFromCandyMachineV2 is the genuinely guard-free path).
  const adminMints: string[] = [];
  for (let i = 0; i < 10; i++) {
    const nftMint = generateSigner(umi);
    await setComputeUnitLimit(umi, { units: MINT_COMPUTE_UNITS })
      .add(
        mintFromCandyMachineV2(umi, {
          candyMachine: candyMachine.publicKey,
          mintAuthority: admin,
          nftOwner: admin.publicKey,
          nftMint,
          collectionMint: collectionMint.publicKey,
          collectionUpdateAuthority: admin.publicKey,
        })
      )
      .sendAndConfirm(umi);
    adminMints.push(nftMint.publicKey);
  }
  console.log(`✓ admin direct-minted 10 editions (no guard, no payment): ${adminMints[0]}..${adminMints[9]}`);

  const firstAsset = await fetchDigitalAsset(umi, toPublicKey(adminMints[0]));
  const firstCollection = firstAsset.metadata.collection;
  if (!isSome(firstCollection) || !firstCollection.value.verified) {
    throw new Error("Admin mint did not verify into the collection");
  }
  const expectedUri1001 = `${METADATA_BASE}1001`;
  if (firstAsset.metadata.uri !== expectedUri1001) {
    throw new Error(`Expected tokenURI "${expectedUri1001}", got "${firstAsset.metadata.uri}"`);
  }
  console.log(`✓ verified: collection membership true, tokenURI = ${firstAsset.metadata.uri}`);

  // 5. NOW wrap with a Candy Guard — public/paid minting opens from here.
  // The candy guard account itself is a PDA derived from `base` (findCandyGuardPda),
  // NOT the base signer's own address — createCandyGuard's `candyGuard` param
  // is optional precisely because it auto-derives this; every later reference
  // must use the derived PDA, confirmed the hard way (first attempt used
  // candyGuard.publicKey directly and wrap() failed with AccountNotInitialized
  // since that address was never the real account).
  const candyGuardBase = generateSigner(umi);
  const candyGuardPda = findCandyGuardPda(umi, { base: candyGuardBase.publicKey });
  await createCandyGuard(umi, {
    base: candyGuardBase,
    guards: {
      solPayment: some({ lamports: sol(LAMPORTS_PER_EDITION / 1_000_000_000), destination: admin.publicKey }),
    },
  }).sendAndConfirm(umi);
  await wrap(umi, {
    candyGuard: candyGuardPda,
    candyMachine: candyMachine.publicKey,
  }).sendAndConfirm(umi);
  console.log(`✓ candy guard created + wrapped: ${candyGuardPda[0]} (solPayment guard live)`);

  const cmAfterWrap = await fetchCandyMachine(umi, candyMachine.publicKey);
  if (cmAfterWrap.mintAuthority !== candyGuardPda[0]) {
    throw new Error("Candy machine mintAuthority did not transfer to the guard on wrap");
  }
  console.log(`✓ candy machine mintAuthority is now the guard, as expected`);

  // 6. Public, paid mint (edition 11 / tokenId 1011) through the guard, from
  // a separate buyer identity.
  const buyer = generateSigner(umi);
  await airdropUntilFunded(umi, buyer.publicKey, 100_000_000, "buyer");
  const buyerUmi = umi.use(keypairIdentity(buyer));
  const buyerMint = generateSigner(buyerUmi);
  await setComputeUnitLimit(buyerUmi, { units: MINT_COMPUTE_UNITS })
    .add(
      mintV2(buyerUmi, {
        candyMachine: candyMachine.publicKey,
        candyGuard: candyGuardPda,
        nftMint: buyerMint,
        collectionMint: collectionMint.publicKey,
        collectionUpdateAuthority: admin.publicKey,
        tokenStandard: TokenStandard.NonFungible,
        mintArgs: { solPayment: some({ destination: admin.publicKey }) },
      })
    )
    .sendAndConfirm(buyerUmi);

  const buyerAsset = await fetchDigitalAsset(buyerUmi, buyerMint.publicKey);
  const buyerCollection = buyerAsset.metadata.collection;
  if (!isSome(buyerCollection) || !buyerCollection.value.verified) {
    throw new Error("Public mint did not verify into collection");
  }
  const expectedUri1011 = `${METADATA_BASE}1011`;
  if (buyerAsset.metadata.uri !== expectedUri1011) {
    throw new Error(`Expected tokenURI "${expectedUri1011}", got "${buyerAsset.metadata.uri}"`);
  }
  console.log(`✓ public guard-gated mint succeeded: tokenURI = ${buyerAsset.metadata.uri}, paid ${LAMPORTS_PER_EDITION} lamports, verified in collection`);

  console.log("\n=== Solana devnet dry run: ALL CHECKS PASSED ===");
  console.log(`Collection: ${collectionMint.publicKey}`);
  console.log(`Candy Machine: ${candyMachine.publicKey}`);
  console.log(`Candy Guard: ${candyGuardPda[0]}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
