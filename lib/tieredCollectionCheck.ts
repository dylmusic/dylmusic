// Real, exact per-token tier lookup for the "Old Dyl NFT collection"
// (0x253bfce1757bb2e5f9159738f8309c73dafe09ea) — the one legacy contract
// that mixes multiple item tiers under one balanceOf count (see CLAUDE.md).
//
// An earlier version of this file gave up on exact tiers after a raw
// eth_getLogs full-history call got rejected by a public RPC (block-range
// cap) and fell back to a min-max estimate. That was the wrong call to
// give up on — Blockscout's own public REST API
// (eth.blockscout.com/api/v2) indexes exactly this ("every tokenId a
// wallet currently holds for a contract, with full metadata inline") as a
// first-class, paginated, no-API-key-needed endpoint. Verified live
// against Dylan's real wallet: 235 tokens, 5 pages of 50, CORS wide open
// (access-control-allow-origin: *) so this runs straight from the
// browser — no proxy needed.

const CONTRACT = "0x253bfce1757bb2e5f9159738f8309c73dafe09ea";
const BASE_URL = `https://eth.blockscout.com/api/v2/tokens/${CONTRACT}/instances`;

export type SingleTier = "standard" | "gold" | "platinum" | "diamond" | "vip" | "mystery" | null;

export interface TieredItem {
  tokenId: string;
  tier: SingleTier;
}

export interface TierBreakdown {
  standard: number;
  gold: number;
  platinum: number;
  diamond: number;
  vip: number;
  mystery: number; // pre-reveal placeholder metadata — tier genuinely unknown
  total: number;
  /** Real per-tokenId list, priced tiers only (standard/gold/platinum/vip) — the actual burn targets, not just a count. */
  items: TieredItem[];
  error?: string;
}

function emptyBreakdown(): TierBreakdown {
  return { standard: 0, gold: 0, platinum: 0, diamond: 0, vip: 0, mystery: 0, total: 0, items: [] };
}

interface BlockscoutInstance {
  id: string;
  metadata?: {
    name?: string;
    attributes?: { trait_type?: string; value?: string }[];
  } | null;
}

interface BlockscoutPage {
  items: BlockscoutInstance[];
  next_page_params: Record<string, string | number> | null;
}

/**
 * Single-tokenId tier lookup, used by lib/burnVerify.ts to price a burn
 * after the fact — same Blockscout instance endpoint, same name/attribute
 * classification fetchTieredCollectionBreakdown already uses, just for one
 * token instead of a wallet's whole paginated holdings list. Reads the
 * instance's CURRENT metadata (works whether the token is still owned by
 * the burner or has already moved to the dead address — Blockscout indexes
 * by tokenId, not by current owner).
 */
export async function fetchSingleInstanceTier(tokenId: string): Promise<{ tier: SingleTier; error?: string }> {
  try {
    const res = await fetch(`${BASE_URL.replace("/instances", "")}/instances/${tokenId}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Blockscout ${res.status}`);
    const item: BlockscoutInstance = await res.json();
    const name = item.metadata?.name ?? "";
    const edition = item.metadata?.attributes?.find((a) => a.trait_type === "Edition")?.value;
    if (name.includes("Mystery")) return { tier: "mystery" };
    if (name.includes("Trading Card")) {
      if (edition === "Standard") return { tier: "standard" };
      if (edition === "Gold") return { tier: "gold" };
      if (edition === "Platinum") return { tier: "platinum" };
      if (edition === "Diamond") return { tier: "diamond" };
      return { tier: "mystery" };
    }
    return { tier: "vip" };
  } catch (e) {
    return { tier: null, error: e instanceof Error ? e.message : "Check failed" };
  }
}

export async function fetchTieredCollectionBreakdown(wallet: string): Promise<TierBreakdown> {
  const breakdown = emptyBreakdown();
  let params: Record<string, string | number> = { holder_address_hash: wallet };

  try {
    // Real holdings can span several pages (Dylan's own wallet is 5 pages
    // at 50/page) — capped at 40 pages (~2000 tokens) as a sanity limit,
    // not expected to ever actually hit that for this collection.
    for (let page = 0; page < 40; page++) {
      const qs = new URLSearchParams(params as Record<string, string>).toString();
      const res = await fetch(`${BASE_URL}?${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Blockscout ${res.status}`);
      const data: BlockscoutPage = await res.json();

      for (const item of data.items) {
        const name = item.metadata?.name ?? "";
        const edition = item.metadata?.attributes?.find((a) => a.trait_type === "Edition")?.value;
        breakdown.total += 1;
        if (name.includes("Mystery")) {
          breakdown.mystery += 1;
        } else if (name.includes("Trading Card")) {
          if (edition === "Standard") {
            breakdown.standard += 1;
            breakdown.items.push({ tokenId: item.id, tier: "standard" });
          } else if (edition === "Gold") {
            breakdown.gold += 1;
            breakdown.items.push({ tokenId: item.id, tier: "gold" });
          } else if (edition === "Platinum") {
            breakdown.platinum += 1;
            breakdown.items.push({ tokenId: item.id, tier: "platinum" });
          } else if (edition === "Diamond") {
            breakdown.diamond += 1; // unpriced — not pushed to items, nothing to burn for credit yet
          } else {
            breakdown.mystery += 1; // unrecognized card edition — don't silently misprice it
          }
        } else {
          breakdown.vip += 1;
          breakdown.items.push({ tokenId: item.id, tier: "vip" });
        }
      }

      if (!data.next_page_params) break;
      params = data.next_page_params;
    }
  } catch (e) {
    breakdown.error = e instanceof Error ? e.message : "Check failed";
  }

  return breakdown;
}
