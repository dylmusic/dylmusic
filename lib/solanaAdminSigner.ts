import type { Signer as UmiSigner, PublicKey as UmiPublicKey } from "@metaplex-foundation/umi";
import { publicKey as toUmiPublicKey } from "@metaplex-foundation/umi";
import { toWeb3JsTransaction, fromWeb3JsTransaction } from "@metaplex-foundation/umi-web3js-adapters";
import type { VersionedTransaction } from "@solana/web3.js";
import type { PhantomProvider } from "./solana";

// Bridges Phantom's raw injected provider (window.solana — same
// lightweight direct-Phantom approach lib/solana.ts already uses, no
// @solana/wallet-adapter-react dependency) into a real Umi Signer, so the
// exact same onchain-solana/ deploy/mint code (already dry-run-proven
// against a real cloned mainnet program set — see create-collection.ts /
// create-track-candy-machine.ts) can run browser-side signed by whoever's
// Phantom is connected in /admin, instead of a local keypair file.
//
// The conversion goes through @metaplex-foundation/umi-web3js-adapters —
// Umi's own transaction type is not the same shape as web3.js's, and
// Phantom's signTransaction/signAllTransactions only understand web3.js
// (or versioned) transactions. toWeb3JsTransaction/fromWeb3JsTransaction
// are Metaplex's own documented conversion functions for exactly this
// boundary, not a hand-rolled serialization.
export function createPhantomUmiSigner(provider: PhantomProvider): UmiSigner {
  if (!provider.publicKey) {
    throw new Error("Phantom is not connected — connect Phantom before building a signer.");
  }
  const publicKey: UmiPublicKey = toUmiPublicKey(provider.publicKey.toString());

  return {
    publicKey,
    async signMessage(message) {
      const { signature } = await provider.signMessage(message);
      return signature;
    },
    async signTransaction(transaction) {
      const web3Tx: VersionedTransaction = toWeb3JsTransaction(transaction);
      const signed = await provider.signTransaction(web3Tx);
      return fromWeb3JsTransaction(signed);
    },
    async signAllTransactions(transactions) {
      const web3Txs = transactions.map((t): VersionedTransaction => toWeb3JsTransaction(t));
      const signed = await provider.signAllTransactions(web3Txs);
      return signed.map((t) => fromWeb3JsTransaction(t));
    },
  };
}
