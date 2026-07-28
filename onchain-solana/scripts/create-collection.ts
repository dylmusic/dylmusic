// ONE-TIME setup script: creates the single Metaplex Certified Collection
// NFT every track's Candy Machine (see create-track-candy-machine.ts) will
// verify its mints into — this is what satisfies dylmusic/CLAUDE.md's
// "single collection" mandate on Solana, the same way one proxy contract
// per chain does on EVM. Run this exactly once, ever, per environment
// (devnet vs mainnet-beta are separate collections).
//
// Run with your own wallet, e.g.:
//   RPC_URL=https://api.mainnet-beta.solana.com \
//   KEYPAIR_PATH=~/.config/solana/id.json \
//   npx ts-node scripts/create-collection.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { createSignerFromKeypair, generateSigner, signerIdentity, percentAmount, some } from "@metaplex-foundation/umi";
import { createNft, mplTokenMetadata } from "@metaplex-foundation/mpl-token-metadata";

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const KEYPAIR_PATH = (process.env.KEYPAIR_PATH ?? "~/.config/solana/id.json").replace(/^~/, os.homedir());
// Same collection-level metadata shape as app/api/metadata/[chain]/collection/route.ts.
const COLLECTION_URI = "https://dylmusic.vercel.app/api/metadata/solana/collection";

async function main() {
  const umi = createUmi(RPC_URL).use(mplTokenMetadata());

  const secretKey = new Uint8Array(JSON.parse(fs.readFileSync(path.resolve(KEYPAIR_PATH), "utf8")));
  const adminKeypair = umi.eddsa.createKeypairFromSecretKey(secretKey);
  const admin = createSignerFromKeypair(umi, adminKeypair);
  umi.use(signerIdentity(admin));

  console.log(`RPC: ${RPC_URL}`);
  console.log(`Admin (collection update authority): ${admin.publicKey}`);

  const collectionMint = generateSigner(umi);
  await createNft(umi, {
    mint: collectionMint,
    name: "Dyl",
    uri: COLLECTION_URI,
    sellerFeeBasisPoints: percentAmount(6.9), // declared, not enforced — matches the EVM ERC-2981 default
    isCollection: true,
    collectionDetails: some({ __kind: "V1" as const, size: 0n }),
  }).sendAndConfirm(umi);

  console.log(`\nCollection NFT created: ${collectionMint.publicKey}`);
  console.log("Save this address — every track's Candy Machine needs it (--collection-mint).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
