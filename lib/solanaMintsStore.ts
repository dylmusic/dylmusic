import { Redis } from "@upstash/redis";

// Solana has no ERC721A-style tokensOfOwner(address) to enumerate admin
// holdings on demand (see lib/contractDeploy.ts's EVM equivalent, used by
// app/admin/page.tsx's Reprice & Relist) — each edition is its own separate
// mint account, not a tokenId under one contract, so there's no single
// on-chain call that answers "which editions does this wallet still hold."
// Recording what deployTrackAndMintAdmin (lib/solanaAdmin.ts) actually
// minted, at mint time, is the practical alternative — same Upstash
// pattern as lib/siteListingsStore.ts, a hash keyed by "trackId:editionNumber"
// so a single edition's record can be read/overwritten directly.

export interface SolanaMintRecord {
  trackId: number;
  editionNumber: number;
  tokenId: number;
  mint: string;
  candyMachine: string;
  // The Candy Guard PDA gating this track's PUBLIC mint (editions #11+) —
  // same for every edition record under a given trackId, since one Candy
  // Guard covers the whole track. Needed to reprice the guard's solPayment
  // amount later (lib/solanaAdmin.ts repriceCandyGuard) without having to
  // re-derive it. Optional because records saved before this field existed
  // won't have it — repricing simply can't target those tracks until
  // they're re-minted or backfilled.
  candyGuard?: string;
  // The price this edition is CURRENTLY listed for on Magic Eden, in SOL —
  // needed because sell_change_price/sell_cancel both require the existing
  // on-chain listing price as an input, not just the new one. Updated every
  // time list/reprice actually succeeds; absent if never listed yet.
  listedPriceSol?: number;
}

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const KEY = "dylmusic:solana:mints";

function fieldKey(trackId: number, editionNumber: number): string {
  return `${trackId}:${editionNumber}`;
}

export async function saveSolanaMints(records: SolanaMintRecord[]): Promise<boolean> {
  const redis = getRedis();
  if (!redis || records.length === 0) return false;
  const fields: Record<string, string> = {};
  for (const r of records) fields[fieldKey(r.trackId, r.editionNumber)] = JSON.stringify(r);
  await redis.hset(KEY, fields);
  return true;
}

export async function getAllSolanaMints(): Promise<SolanaMintRecord[]> {
  const redis = getRedis();
  if (!redis) return [];
  const all = await redis.hgetall<Record<string, string>>(KEY);
  if (!all) return [];
  return Object.values(all)
    .map((raw) => {
      try {
        return typeof raw === "string" ? (JSON.parse(raw) as SolanaMintRecord) : (raw as unknown as SolanaMintRecord);
      } catch {
        return null;
      }
    })
    .filter((r): r is SolanaMintRecord => r !== null);
}
