"use client";

import { encodeFunctionData, type Address, type Hex } from "viem";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { createBurnCheckedInstruction, getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import { DEAD_ADDRESS_EVM } from "./burnVerify";
import { SOLANA_RPC_URL } from "./solana";

// Real burn-transaction builders — the WRITE half of lib/burnVerify.ts's
// read-only checks. EVM burns are plain, standard, already-proven
// primitives (ERC721 safeTransferFrom / ERC20 transfer, same shape as
// every other on-chain write already in this codebase); Solana burns use
// the real SPL Token `BurnChecked` instruction, same package
// (@solana/spl-token) lib/solana.ts already depends on.

const ERC721_SAFE_TRANSFER_ABI = [
  {
    name: "safeTransferFrom",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "address" }, { type: "uint256" }],
    outputs: [],
  },
] as const;

const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
] as const;

export interface RawEvmTx {
  to: Address;
  data: Hex;
  value: bigint;
}

/** Real ERC721 burn — a plain transfer to the standard dead address, same "burn" convention CLAUDE.md documents for every EVM/Tezos legacy asset. */
export function buildEvmNftBurnTx(contract: Address, from: Address, tokenId: bigint): RawEvmTx {
  const data = encodeFunctionData({
    abi: ERC721_SAFE_TRANSFER_ABI,
    functionName: "safeTransferFrom",
    args: [from, DEAD_ADDRESS_EVM as Address, tokenId],
  });
  return { to: contract, data, value: BigInt(0) };
}

/** Real ERC20 $DYL burn — transfers the given amount (already in base units) to the dead address. */
export function buildEvmDylBurnTx(dylContract: Address, amountWei: bigint): RawEvmTx {
  const data = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [DEAD_ADDRESS_EVM as Address, amountWei],
  });
  return { to: dylContract, data, value: BigInt(0) };
}

/**
 * Real Solana SPL burn — no dead-address convention on Solana (see
 * CLAUDE.md/lib/burnVerify.ts), so this is a genuine protocol-level
 * `BurnChecked` instruction against the owner's Associated Token Account,
 * signed and sent via Phantom (`window.solana`, same injected-provider
 * pattern lib/solana.ts already uses). NFTs from this collection are
 * always decimals=0, amount=1.
 */
export async function burnSolanaNft(
  ownerAddress: string,
  mintAddress: string
): Promise<{ txHash: string }> {
  const provider = (window as unknown as { solana?: { signAndSendTransaction: (tx: Transaction) => Promise<{ signature: string }> } }).solana;
  if (!provider) throw new Error("Phantom not found.");

  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  const owner = new PublicKey(ownerAddress);
  const mint = new PublicKey(mintAddress);
  const ata = await getAssociatedTokenAddress(mint, owner);

  const ix = createBurnCheckedInstruction(ata, mint, owner, 1, 0);
  const tx = new Transaction().add(ix);
  tx.feePayer = owner;
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;

  const { signature } = await provider.signAndSendTransaction(tx);
  await connection.confirmTransaction(signature, "confirmed");
  return { txHash: signature };
}

/**
 * Real Solana $DYL burn — burns the wallet's ENTIRE current balance (same
 * "burn all" UX as the EVM $DYL burn button), reading the real raw
 * amount/decimals off the Associated Token Account itself rather than
 * trusting a previously-fetched UI number.
 */
export async function burnSolanaDyl(ownerAddress: string, dylMint: string): Promise<{ txHash: string }> {
  const provider = (window as unknown as { solana?: { signAndSendTransaction: (tx: Transaction) => Promise<{ signature: string }> } }).solana;
  if (!provider) throw new Error("Phantom not found.");

  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  const owner = new PublicKey(ownerAddress);
  const mint = new PublicKey(dylMint);
  const ata = await getAssociatedTokenAddress(mint, owner);
  const account = await getAccount(connection, ata);
  if (account.amount <= BigInt(0)) throw new Error("No $DYL balance to burn.");

  const mintInfo = await connection.getParsedAccountInfo(mint);
  const decimals = (mintInfo.value?.data as { parsed?: { info?: { decimals?: number } } })?.parsed?.info?.decimals ?? 0;

  const ix = createBurnCheckedInstruction(ata, mint, owner, account.amount, decimals);
  const tx = new Transaction().add(ix);
  tx.feePayer = owner;
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;

  const { signature } = await provider.signAndSendTransaction(tx);
  await connection.confirmTransaction(signature, "confirmed");
  return { txHash: signature };
}
