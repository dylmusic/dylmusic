// Runs server-side now (called from app/api/solana-check/route.ts, not
// directly from the browser) — the public Solana RPC 403s a lot of
// residential/mobile IPs under its own abuse-prevention (confirmed: the
// endpoint itself answered fine from a server IP while a real user's
// browser got a 403 on the identical call), so this moved off the client
// to run from one consistent server IP instead of every visitor's own.
import { Connection, PublicKey } from "@solana/web3.js";

// Same public RPC lib/dylSwap.ts already uses for real Solana reads.
const SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

// $DYL (Solana) — see lib/legacyCollections.ts, same address.
export const DYL_SOL_MINT = "DTUW2CFo71KnTNSFYX95jQ8P8aJVQVr8MEF1AGMm5WGm";

// "Crypto Rich Deluxe Trading Cards" candy machine — see CLAUDE.md.
// An earlier version of this file matched the on-chain `symbol` field
// against the marketplace's collection *slug* ("crypto_rich_deluxe_trading_
// cards") — that can never match anything real: Metaplex's on-chain symbol
// field is capped at 10 bytes, so a 33-character slug was never going to
// appear there. Verified live against the collection's own floor NFT
// (mint 3r7CWTme5bM4nNwHk9GRjygBBS2i5n5R3CQV4GvwQwsu, per CLAUDE.md): its
// real on-chain symbol is just "CRT", and its `creators` array has this
// candy machine ID first, `verified: true` — that verified-creator flag is
// the real, standard proof a token was minted by this candy machine
// (Metaplex sets it via the mint's own `sign_metadata`, can't be forged by
// a later holder), so that's what's checked now instead of the symbol.
export const CANDY_MACHINE_ID = "7JvmupdkaFekk2bqqesk4Y22ejQhmpC8Gx5AkB3usgPw";

export interface SolanaTierBreakdown {
  standard: number;
  gold: number;
  platinum: number;
  diamond: number;
  // verified-creator match but the on-chain name didn't contain a
  // recognized tier word — shouldn't happen for this collection, but never
  // silently dropped if it does.
  unknown: number;
  total: number;
}

export interface SolanaTieredItem {
  mint: string;
  tier: "standard" | "gold" | "platinum";
}

export interface SolanaCheckResult {
  dylBalance: number;
  tiers: SolanaTierBreakdown;
  /** Real per-mint list, priced tiers only (standard/gold/platinum) — the actual burn targets, not just a count. */
  items: SolanaTieredItem[];
  error?: string;
}

export function emptyTiers(): SolanaTierBreakdown {
  return { standard: 0, gold: 0, platinum: 0, diamond: 0, unknown: 0, total: 0 };
}

function metadataPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID
  );
  return pda;
}

interface ParsedCreator {
  address: string;
  verified: boolean;
}

interface ParsedMetadata {
  name: string;
  creators: ParsedCreator[];
}

function readString(buf: Buffer, offset: number): [string, number] {
  const len = buf.readUInt32LE(offset);
  const str = buf
    .subarray(offset + 4, offset + 4 + len)
    .toString("utf8")
    .replace(/\0/g, "")
    .trim();
  return [str, offset + 4 + len];
}

// Full Metaplex Metadata account parse (name, symbol, uri, then the
// Option<Vec<Creator>> block) — same layout used to verify this collection
// live, just reading further into the struct than the old symbol-only
// parse did. Layout: 1 (key) + 32 (updateAuthority) + 32 (mint) + name +
// symbol + uri + 2 (sellerFeeBasisPoints) + 1 (Option tag) + [4 (vec len) +
// n * (32 address + 1 verified + 1 share)].
function parseMetadata(data: Buffer): ParsedMetadata | null {
  try {
    let offset = 1 + 32 + 32;
    let name: string;
    [name, offset] = readString(data, offset);
    let symbol: string;
    [symbol, offset] = readString(data, offset);
    let uri: string;
    [uri, offset] = readString(data, offset);
    void symbol;
    void uri;
    offset += 2; // sellerFeeBasisPoints
    const hasCreators = data[offset];
    offset += 1;
    const creators: ParsedCreator[] = [];
    if (hasCreators === 1) {
      const count = data.readUInt32LE(offset);
      offset += 4;
      for (let i = 0; i < count; i++) {
        const address = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
        const verified = data[offset + 32] === 1;
        creators.push({ address, verified });
        offset += 34; // 32 address + 1 verified + 1 share
      }
    }
    return { name, creators };
  } catch {
    return null;
  }
}

function tierFromName(name: string): keyof Omit<SolanaTierBreakdown, "unknown" | "total"> | null {
  if (/standard/i.test(name)) return "standard";
  if (/gold/i.test(name)) return "gold";
  if (/platinum/i.test(name)) return "platinum";
  if (/diamond/i.test(name)) return "diamond";
  return null;
}

/**
 * Single-mint tier lookup — used by lib/burnVerify.ts to price a burn
 * AFTER the fact (the wallet no longer needs to hold the token, only the
 * mint address matters). Reuses the exact same metadata-PDA parse and
 * verified-creator check checkSolanaWallet already proved live, just for
 * one mint instead of enumerating a wallet's full token-account list.
 * Reads the metadata account as it exists NOW — correct as long as
 * burning used a raw SPL `burn` instruction (per CLAUDE.md's design),
 * which only zeroes the token account's balance and never touches/closes
 * the mint's own metadata account, unlike Metaplex's `burn_nft` CPI.
 */
export async function fetchMintTier(
  mintAddress: string
): Promise<{ verifiedOurs: boolean; tier: keyof Omit<SolanaTierBreakdown, "unknown" | "total"> | null }> {
  try {
    const connection = new Connection(SOLANA_RPC_URL);
    const pda = metadataPda(new PublicKey(mintAddress));
    const acc = await connection.getAccountInfo(pda);
    if (!acc) return { verifiedOurs: false, tier: null };
    const parsed = parseMetadata(acc.data);
    if (!parsed) return { verifiedOurs: false, tier: null };
    const isOurs = parsed.creators.some((c) => c.address === CANDY_MACHINE_ID && c.verified);
    if (!isOurs) return { verifiedOurs: false, tier: null };
    return { verifiedOurs: true, tier: tierFromName(parsed.name) };
  } catch {
    return { verifiedOurs: false, tier: null };
  }
}

export async function checkSolanaWallet(walletAddress: string): Promise<SolanaCheckResult> {
  const tiers = emptyTiers();
  let dylBalance = 0;
  let error: string | undefined;

  try {
    const connection = new Connection(SOLANA_RPC_URL);
    const owner = new PublicKey(walletAddress);
    const accounts = await connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID });

    // NFT-like candidates: amount exactly 1, 0 decimals (standard SPL NFT
    // shape). Capped defensively so a wallet with hundreds of unrelated
    // tokens can't make this hang.
    const nftMints: PublicKey[] = [];
    for (const { account } of accounts.value) {
      const info = account.data.parsed.info;
      const amount = info.tokenAmount;
      if (info.mint === DYL_SOL_MINT) {
        dylBalance = amount.uiAmount ?? 0;
        continue;
      }
      if (amount.decimals === 0 && amount.uiAmount === 1) {
        nftMints.push(new PublicKey(info.mint));
      }
      if (nftMints.length >= 250) break;
    }

    const items: SolanaTieredItem[] = [];
    if (nftMints.length > 0) {
      const pdas = nftMints.map(metadataPda);
      // getMultipleAccountsInfo batches internally in chunks of 100 —
      // fine for our 250 cap. Sliced in lockstep with nftMints so each
      // result can be matched back to its real mint address (needed to
      // actually burn a specific card later, not just count it).
      for (let i = 0; i < pdas.length; i += 100) {
        const pdaChunk = pdas.slice(i, i + 100);
        const mintChunk = nftMints.slice(i, i + 100);
        const infos = await connection.getMultipleAccountsInfo(pdaChunk);
        infos.forEach((acc, j) => {
          if (!acc) return;
          const parsed = parseMetadata(acc.data);
          if (!parsed) return;
          const isOurs = parsed.creators.some((c) => c.address === CANDY_MACHINE_ID && c.verified);
          if (!isOurs) return;
          tiers.total += 1;
          const tier = tierFromName(parsed.name);
          if (tier) {
            tiers[tier] += 1;
            if (tier !== "diamond") items.push({ mint: mintChunk[j].toBase58(), tier }); // diamond unpriced, nothing to burn for credit yet
          } else {
            tiers.unknown += 1;
          }
        });
      }
    }

    return { dylBalance, tiers, items, error };
  } catch (e) {
    error = e instanceof Error ? e.message : "Check failed";
  }

  return { dylBalance, tiers, items: [], error };
}
