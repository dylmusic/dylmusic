"use client";

import { Connection, PublicKey } from "@solana/web3.js";

// Same public RPC lib/dylSwap.ts already uses for real Solana reads.
const SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

// $DYL (Solana) — see lib/legacyCollections.ts, same address.
export const DYL_SOL_MINT = "DTUW2CFo71KnTNSFYX95jQ8P8aJVQVr8MEF1AGMm5WGm";

// "Crypto Rich Deluxe Trading Cards" candy machine — see CLAUDE.md, sourced
// live from Magic Eden's own collection state (symbol tied to this
// candy machine ID). Metaplex NFT metadata's on-chain `symbol` field is
// what's matched against per held token below — best-effort (couldn't
// verify against one real minted token from this exact collection in this
// session), not a cryptographic guarantee the way the EVM tier lookup is.
const TRADING_CARD_SYMBOL = "crypto_rich_deluxe_trading_cards";

export interface SolanaCheckResult {
  dylBalance: number;
  cardCount: number;
  error?: string;
}

function metadataPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID
  );
  return pda;
}

// Manual byte-offset parse of just the `symbol` field from a Metaplex
// Metadata account — same technique used to verify this collection live
// earlier (see CLAUDE.md), just reading one field instead of the whole
// struct. Layout: 1 (key) + 32 (updateAuthority) + 32 (mint) + 4 (name len)
// + name + 4 (symbol len) + symbol...
function parseSymbol(data: Buffer): string | null {
  try {
    let offset = 1 + 32 + 32;
    const nameLen = data.readUInt32LE(offset);
    offset += 4 + nameLen;
    const symbolLen = data.readUInt32LE(offset);
    offset += 4;
    return data.subarray(offset, offset + symbolLen).toString("utf8").replace(/\0/g, "").trim();
  } catch {
    return null;
  }
}

export async function checkSolanaWallet(walletAddress: string): Promise<SolanaCheckResult> {
  const connection = new Connection(SOLANA_RPC_URL);
  const owner = new PublicKey(walletAddress);

  let dylBalance = 0;
  let cardCount = 0;
  let error: string | undefined;

  try {
    const accounts = await connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID });

    // NFT-like candidates: amount exactly 1, 0 decimals (standard SPL NFT
    // shape). Capped defensively so a wallet with hundreds of unrelated
    // tokens can't make this hang.
    const nftMints: PublicKey[] = [];
    for (const { account } of accounts.value) {
      const info = account.data.parsed.info;
      const amount = info.tokenAmount;
      if (amount.decimals === 0 && amount.uiAmount === 1) {
        nftMints.push(new PublicKey(info.mint));
      } else if (info.mint === DYL_SOL_MINT) {
        dylBalance = amount.uiAmount ?? 0;
      }
      if (nftMints.length >= 250) break;
    }

    if (nftMints.length > 0) {
      const pdas = nftMints.map(metadataPda);
      // getMultipleAccountsInfo batches internally in chunks of 100 —
      // fine for our 250 cap.
      for (let i = 0; i < pdas.length; i += 100) {
        const chunk = pdas.slice(i, i + 100);
        const infos = await connection.getMultipleAccountsInfo(chunk);
        for (const acc of infos) {
          if (!acc) continue;
          const symbol = parseSymbol(acc.data);
          if (symbol === TRADING_CARD_SYMBOL) cardCount += 1;
        }
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "Check failed";
  }

  return { dylBalance, cardCount, error };
}
