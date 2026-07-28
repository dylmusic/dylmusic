// Burn -> free-mint credit values, Ethereum + $DYL only (Solana/Tezos not
// wired up yet). Source of truth is CLAUDE.md's "Burn -> free-mint reward
// ratio" table, as given directly by Dylan on 2026-07-27 (superseding an
// earlier 3/5/7 draft) — copied here as plain constants rather than
// re-deriving them, so a future change only has to happen in one place.

export type CardTier = "standard" | "gold" | "platinum" | "diamond";

export const CARD_TIER_MINTS: Record<CardTier, number | null> = {
  standard: 5,
  gold: 10,
  platinum: 20,
  // Dylan hasn't given a Diamond number yet — null means "not priced",
  // never silently treated as 0.
  diamond: null,
};

// The "Old Dyl NFT collection" (0x253bfce...) VIP-tier items (Deluxe/Classic
// album covers, one-off song covers, the PFP) — only the 1/200 Deluxe VIP
// sub-tier has a confirmed number (50). The 1/10 Classic Rare and 1/1
// Singles sub-tiers don't have their own number yet, so every VIP-category
// item uses this one figure as the best available estimate.
export const VIP_MINTS_ESTIMATE = 50;

// $DYL is a balance THRESHOLD, not a per-token burn count — hold >= this
// much and you clear the tier (tiers don't stack).
export const DYL_THRESHOLDS: { min: number; mints: number }[] = [
  { min: 10_000_000, mints: 50 },
  { min: 1_000_000, mints: 5 },
];

export function dylMintsForBalance(balance: number): number {
  for (const t of DYL_THRESHOLDS) {
    if (balance >= t.min) return t.mints;
  }
  return 0;
}

export function mintsForCardTier(tier: CardTier): number | null {
  return CARD_TIER_MINTS[tier];
}

// Robinhood Chain isn't in this reward table yet (it's the live/current
// chain, not a "legacy" one) — allocation targets are just the chains
// the new collection actually mints on (Ethereum added 2026-07-28
// alongside lib/albums.ts CHAINS — see that file for why).
export const ALLOCATION_CHAINS = ["robinhood", "base", "solana", "ethereum"] as const;
export type AllocationChain = (typeof ALLOCATION_CHAINS)[number];
