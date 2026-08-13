// Real, server-side burn verification — one function per origin chain,
// each independently re-deriving the burn from that chain's own indexer or
// RPC rather than trusting anything the client submits. This is the entire
// trust boundary for burn-and-mint: a client can claim to have burned
// anything, but only a real, found, on-chain event here ever turns into a
// credit (see lib/burnLedgerStore.ts).
//
// Every endpoint below was verified live (real curl calls) before being
// used here, same discipline as lib/tieredCollectionCheck.ts/
// lib/tezosCollectionCheck.ts already established for this codebase — no
// guessed API shapes.

import { Connection, PublicKey } from "@solana/web3.js";
import { SOLANA_RPC_URL } from "./solana";

export const DEAD_ADDRESS_EVM = "0x000000000000000000000000000000000000dead";
export const DEAD_ADDRESS_TEZOS = "tz1burnburnburnburnburnburnburjAYjjX";

const BLOCKSCOUT_HOST: Record<"ethereum" | "base" | "polygon", string> = {
  ethereum: "eth.blockscout.com",
  base: "base.blockscout.com",
  polygon: "polygon.blockscout.com",
};

interface BlockscoutTransferAddr {
  hash: string;
}
interface BlockscoutInstanceTransfer {
  from: BlockscoutTransferAddr;
  to: BlockscoutTransferAddr;
  transaction_hash: string;
}
interface BlockscoutInstanceTransfersPage {
  items: BlockscoutInstanceTransfer[];
  next_page_params: Record<string, string | number> | null;
}

/** Real Ethereum NFT burn: did `wallet` genuinely send this exact tokenId to the dead address? */
export async function verifyEthereumNftBurn(
  wallet: string,
  contract: string,
  tokenId: string
): Promise<{ burned: boolean; txHash?: string; error?: string }> {
  try {
    const w = wallet.toLowerCase();
    let params: Record<string, string | number> = {};
    for (let page = 0; page < 10; page++) {
      const qs = new URLSearchParams(params as Record<string, string>).toString();
      const url = `https://${BLOCKSCOUT_HOST.ethereum}/api/v2/tokens/${contract}/instances/${tokenId}/transfers${qs ? `?${qs}` : ""}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Blockscout ${res.status}`);
      const data: BlockscoutInstanceTransfersPage = await res.json();
      const hit = data.items.find(
        (t) => t.from.hash.toLowerCase() === w && t.to.hash.toLowerCase() === DEAD_ADDRESS_EVM
      );
      if (hit) return { burned: true, txHash: hit.transaction_hash };
      if (!data.next_page_params) break;
      params = data.next_page_params;
    }
    return { burned: false };
  } catch (e) {
    return { burned: false, error: e instanceof Error ? e.message : "Check failed" };
  }
}

interface BlockscoutAddrTransfer {
  from: BlockscoutTransferAddr;
  to: BlockscoutTransferAddr;
  total?: { value?: string; decimals?: string };
  transaction_hash: string;
}
interface BlockscoutAddrTransfersPage {
  items: BlockscoutAddrTransfer[];
  next_page_params: Record<string, string | number> | null;
}

/**
 * Real cumulative $DYL burned by `wallet` on one EVM chain — sums every
 * Transfer(wallet -> dead) for the $DYL token, scoped to the WALLET's own
 * transfer history (small/fast) rather than scanning the token's entire
 * history. Threshold crediting (crossing $1M/$10M) is computed by the
 * caller from this total — see lib/burnCredits.ts's dylMintsForBalance and
 * lib/burnLedgerStore.ts's recordDylThresholdCredit for why this must be a
 * "highest tier crossed" delta, not a flat re-credit on every check.
 */
export async function verifyEvmDylBurnedAmount(
  chain: "ethereum" | "base" | "polygon",
  wallet: string,
  dylContract: string
): Promise<{ totalBurned: number; error?: string }> {
  try {
    const w = wallet.toLowerCase();
    let total = 0;
    let params: Record<string, string | number> = {};
    for (let page = 0; page < 20; page++) {
      const qs = new URLSearchParams({ token: dylContract, type: "ERC-20", ...params } as Record<string, string>).toString();
      const url = `https://${BLOCKSCOUT_HOST[chain]}/api/v2/addresses/${wallet}/token-transfers?${qs}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Blockscout ${res.status}`);
      const data: BlockscoutAddrTransfersPage = await res.json();
      for (const t of data.items) {
        if (t.from.hash.toLowerCase() === w && t.to.hash.toLowerCase() === DEAD_ADDRESS_EVM && t.total?.value) {
          const decimals = Number(t.total.decimals ?? 18);
          total += Number(t.total.value) / 10 ** decimals;
        }
      }
      if (!data.next_page_params) break;
      params = data.next_page_params;
    }
    return { totalBurned: total };
  } catch (e) {
    return { totalBurned: 0, error: e instanceof Error ? e.message : "Check failed" };
  }
}

interface TzktTransfer {
  from?: { address: string };
  to?: { address: string };
  transactionId: number;
}

/** Real Tezos FA2 burn: did `wallet` send this NFT to the labeled TzKT burn address? */
export async function verifyTezosNftBurn(
  wallet: string,
  contract: string,
  tokenId: string
): Promise<{ burned: boolean; txHash?: string; error?: string }> {
  try {
    const qs = new URLSearchParams({
      "token.contract": contract,
      "token.tokenId": tokenId,
      from: wallet,
      to: DEAD_ADDRESS_TEZOS,
      select: "from,to,transactionId",
      limit: "10",
    });
    const res = await fetch(`https://api.tzkt.io/v1/tokens/transfers?${qs}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`TzKT ${res.status}`);
    const rows: TzktTransfer[] = await res.json();
    const hit = rows.find((r) => r.from?.address === wallet && r.to?.address === DEAD_ADDRESS_TEZOS);
    if (hit) return { burned: true, txHash: String(hit.transactionId) };
    return { burned: false };
  } catch (e) {
    return { burned: false, error: e instanceof Error ? e.message : "Check failed" };
  }
}

/**
 * Real cumulative $DYL burned on Solana by `wallet` — scans the WALLET's
 * own recent transaction history (not the mint's, which could be huge and
 * shared across every holder) for real spl-token burn/burnChecked
 * instructions against the $DYL mint, summing amounts. Same threshold-
 * crediting caller pattern as the EVM version (lib/burnLedgerStore.ts's
 * recordDylThresholdCredit) — this returns a total, not a credit decision.
 */
export async function verifySolanaDylBurnedAmount(
  wallet: string,
  dylMint: string
): Promise<{ totalBurned: number; error?: string }> {
  try {
    const connection = new Connection(SOLANA_RPC_URL, "confirmed");
    const owner = new PublicKey(wallet);
    const signatures = await connection.getSignaturesForAddress(owner, { limit: 1000 });
    let total = 0;
    for (const sigInfo of signatures) {
      const tx = await connection.getParsedTransaction(sigInfo.signature, { maxSupportedTransactionVersion: 0 });
      if (!tx?.meta || tx.meta.err) continue;
      for (const ix of tx.transaction.message.instructions) {
        if (!("parsed" in ix) || ix.program !== "spl-token") continue;
        const type = ix.parsed?.type;
        if (type !== "burn" && type !== "burnChecked") continue;
        const info = ix.parsed?.info;
        const authority = info?.authority ?? info?.owner;
        if (info?.mint !== dylMint || authority !== wallet) continue;
        // Only BurnChecked (what our own burn action always uses) reliably
        // carries decimals in its parsed output (tokenAmount.uiAmount) — a
        // plain, non-checked `burn` elsewhere has no safe way to convert
        // raw base units without guessing decimals, so it's skipped rather
        // than risk crediting a wrong (possibly inflated) amount.
        const amount = info?.tokenAmount?.uiAmount;
        if (typeof amount === "number") total += amount;
      }
    }
    return { totalBurned: total };
  } catch (e) {
    return { totalBurned: 0, error: e instanceof Error ? e.message : "Check failed" };
  }
}

/**
 * Real Solana SPL burn — no dead-address convention exists on Solana (see
 * CLAUDE.md), so this looks for an actual protocol-level `burn`/
 * `burnChecked` instruction against `mintAddress`, signed by `wallet`, in
 * that mint's own recent transaction history (a burned NFT's mint account
 * still exists and still shows its full history — burning destroys the
 * token account's balance, not the mint's transaction log).
 */
export async function verifySolanaBurn(
  wallet: string,
  mintAddress: string
): Promise<{ burned: boolean; txHash?: string; error?: string }> {
  try {
    const connection = new Connection(SOLANA_RPC_URL, "confirmed");
    const mintPubkey = new PublicKey(mintAddress);
    const signatures = await connection.getSignaturesForAddress(mintPubkey, { limit: 50 });
    for (const sigInfo of signatures) {
      const tx = await connection.getParsedTransaction(sigInfo.signature, {
        maxSupportedTransactionVersion: 0,
      });
      if (!tx?.meta || tx.meta.err) continue;
      const allInstructions = tx.transaction.message.instructions;
      for (const ix of allInstructions) {
        if (!("parsed" in ix) || ix.program !== "spl-token") continue;
        const type = ix.parsed?.type;
        if (type !== "burn" && type !== "burnChecked") continue;
        const info = ix.parsed?.info;
        const authority = info?.authority ?? info?.owner;
        const mint = info?.mint;
        if (mint === mintAddress && authority === wallet) {
          return { burned: true, txHash: sigInfo.signature };
        }
      }
    }
    return { burned: false };
  } catch (e) {
    return { burned: false, error: e instanceof Error ? e.message : "Check failed" };
  }
}
