import { Redis } from "@upstash/redis";
import { createPublicClient, http, type Address } from "viem";
import { CONTRACT_TARGETS } from "./admin";
import { ROBINHOOD_CHAIN_SERVER, ROBINHOOD_RPC_URL } from "./robinhoodChainServer";
import { BurnClaimRedeemerAbi } from "./contractDeploy";

// Real, server-side free-mint credit ledger for burn-and-mint — same
// Upstash pattern as lib/chatStore.ts/lib/activityStore.ts. This is the
// ONLY place "how many free mints does this wallet have" is computed —
// never trust a client-submitted total (see lib/burnVerify.ts for how
// credits actually get earned).

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const ledgerKey = (wallet: string) => `dylmusic:burn:ledger:${wallet.toLowerCase()}`;
const pendingKey = (wallet: string) => `dylmusic:burn:pending:${wallet.toLowerCase()}`;
const seenKey = (eventKey: string) => `dylmusic:burn:seen:${eventKey}`;
const dylTierKey = (chain: string, wallet: string) => `dylmusic:burn:dyltier:${chain}:${wallet.toLowerCase()}`;
const lockKey = (wallet: string) => `dylmusic:burn:lock:${wallet.toLowerCase()}`;

/**
 * Serializes "check spendable, then commit a reservation" per wallet — the
 * read-then-write in reserveVoucherCredits below is otherwise a genuine
 * TOCTOU race: two concurrent /api/burn/claim-voucher requests for the same
 * wallet could both read the same spendable total, both pass the check, and
 * both commit a pending voucher, over-granting real free mints beyond what
 * was actually earned. Upstash's REST client has no MULTI/WATCH, so this
 * uses a short-lived SET NX PX lock (a standard distributed-lock pattern)
 * rather than a Lua script, to keep the fix self-contained and easy to
 * reason about. A stuck/crashed holder can never wedge future claims
 * permanently — the lock's own PX expiry releases it regardless.
 */
async function withWalletLock<T>(redis: Redis, wallet: string, fn: () => Promise<T>): Promise<T> {
  const key = lockKey(wallet);
  const token = `${Date.now()}:${Math.random()}`;
  let acquired = false;
  for (let i = 0; i < 40; i++) {
    const res = await redis.set(key, token, { nx: true, px: 8000 });
    if (res !== null) {
      acquired = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!acquired) throw new Error("Ledger is busy — try again in a moment.");
  try {
    return await fn();
  } finally {
    // Only release if we still hold it — never clear a lock some other,
    // later request has since acquired after ours expired.
    const current = await redis.get<string>(key);
    if (current === token) await redis.del(key);
  }
}

export interface BurnLedger {
  earned: number;
  pending: number;
  spent: number;
  spendable: number;
}

const EMPTY_LEDGER: BurnLedger = { earned: 0, pending: 0, spent: 0, spendable: 0 };

async function isClaimedOnChain(claimId: string): Promise<boolean> {
  // Every claim today is on Robinhood Chain only (see the burn-and-mint
  // plan's "Robinhood only for now" scope) — this reconciliation check
  // widens automatically once more chains' redeemers exist, by checking
  // each one, not by any change to the caller.
  const target = CONTRACT_TARGETS.find((t) => t.key === "robinhood");
  if (!target?.burnClaimRedeemerAddress || !target.chainId) return false;
  try {
    const client = createPublicClient({ chain: ROBINHOOD_CHAIN_SERVER, transport: http(ROBINHOOD_RPC_URL) });
    return (await client.readContract({
      address: target.burnClaimRedeemerAddress as Address,
      abi: BurnClaimRedeemerAbi,
      functionName: "claimed",
      args: [claimId as `0x${string}`],
    })) as boolean;
  } catch {
    // A failed chain read must NEVER be treated as "not claimed" for the
    // purpose of rolling credits back — leave the pending record in place
    // (unreconciled this pass) rather than risk a false roll-back that
    // lets someone re-spend credits they already successfully claimed.
    return false;
  }
}

/**
 * Reconciles every pending voucher record for a wallet against REAL
 * on-chain state before any spendable total is computed. A pending
 * voucher's credits must never silently return to `spendable` just
 * because it expired or the frontend never reported success (tab closed
 * mid-claim, etc.) — if the chain says it was actually claimed, the
 * credit is real and permanent (moved to `spent`); only a genuinely
 * expired AND never-claimed voucher rolls back.
 */
async function reconcilePending(redis: Redis, wallet: string): Promise<void> {
  const key = pendingKey(wallet);
  const now = Math.floor(Date.now() / 1000);
  const members = (await redis.zrange(key, 0, -1)) as string[];
  for (const member of members) {
    const [claimId, amountStr] = member.split("|");
    const amount = Number(amountStr);
    if (!claimId || !Number.isFinite(amount)) {
      await redis.zrem(key, member); // corrupt entry, drop it rather than let it wedge the ledger forever
      continue;
    }
    const claimedOnChain = await isClaimedOnChain(claimId);
    if (claimedOnChain) {
      await redis.hincrby(ledgerKey(wallet), "spent", amount);
      await redis.zrem(key, member);
      continue;
    }
    const score = await redis.zscore(key, member);
    if (score !== null && Number(score) < now) {
      await redis.zrem(key, member); // expired, genuinely never claimed — safe to roll back
    }
  }
}

export async function getLedger(wallet: string): Promise<BurnLedger> {
  const redis = getRedis();
  if (!redis) return EMPTY_LEDGER;
  await reconcilePending(redis, wallet);

  const hash = await redis.hgetall<Record<string, string | number>>(ledgerKey(wallet));
  const earned = Number(hash?.earned ?? 0);
  const spent = Number(hash?.spent ?? 0);

  const now = Math.floor(Date.now() / 1000);
  const activeMembers = (await redis.zrange(pendingKey(wallet), now, "+inf", { byScore: true })) as string[];
  const pending = activeMembers.reduce((sum, m) => {
    const amount = Number(m.split("|")[1]);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);

  const spendable = Math.max(0, earned - pending - spent);
  return { earned, pending, spent, spendable };
}

/** One-time credit for a discrete burn event (an NFT burn, or an already-computed amount). Dedup key must be globally unique per real burn event — never credited twice, ever. */
export async function recordBurnCredit(
  eventKey: string,
  wallet: string,
  amount: number
): Promise<{ credited: boolean }> {
  const redis = getRedis();
  if (!redis || amount <= 0) return { credited: false };
  const isNew = await redis.set(seenKey(eventKey), "1", { nx: true });
  if (!isNew) return { credited: false };
  await redis.hincrby(ledgerKey(wallet), "earned", amount);
  return { credited: true };
}

/**
 * $DYL is a threshold model (see lib/burnCredits.ts) — `currentMints` is
 * whatever the CURRENT cumulative burned balance qualifies for. Credits
 * only the DELTA above whatever tier was already credited before, so
 * re-verifying at the same or a lower burned total credits nothing
 * further, and crossing a higher tier later credits exactly the
 * difference rather than double-paying the lower tier's amount again.
 */
export async function recordDylThresholdCredit(
  chain: string,
  wallet: string,
  currentMints: number
): Promise<{ credited: number }> {
  const redis = getRedis();
  if (!redis) return { credited: 0 };
  // Same read-then-write race as reserveVoucherCredits below — two
  // concurrent checks crossing the same tier at once must never both
  // credit the delta.
  return withWalletLock(redis, wallet, async () => {
    const key = dylTierKey(chain, wallet);
    const prevMints = Number((await redis.get(key)) ?? 0);
    if (currentMints <= prevMints) return { credited: 0 };
    const delta = currentMints - prevMints;
    await redis.set(key, currentMints);
    await redis.hincrby(ledgerKey(wallet), "earned", delta);
    return { credited: delta };
  });
}

/**
 * Commits `amount` spendable credits to a just-issued voucher (called at
 * voucher-issuance time, before the signature is ever handed back to the
 * client) — re-derives spendable fresh (reconciled) rather than trusting
 * any previously-read value, so two concurrent voucher requests can't both
 * succeed against the same credits.
 */
export async function reserveVoucherCredits(
  wallet: string,
  claimId: string,
  amount: number,
  expiryUnixSec: number
): Promise<boolean> {
  const redis = getRedis();
  if (!redis || amount <= 0) return false;
  return withWalletLock(redis, wallet, async () => {
    const ledger = await getLedger(wallet);
    if (amount > ledger.spendable) return false;
    await redis.zadd(pendingKey(wallet), { score: expiryUnixSec, member: `${claimId}|${amount}` });
    return true;
  });
}

export function burnLedgerConfigured(): boolean {
  return getRedis() !== null;
}
