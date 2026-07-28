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

export interface TierBreakdown {
  standard: number;
  gold: number;
  platinum: number;
  diamond: number;
  vip: number;
  mystery: number; // pre-reveal placeholder metadata — tier genuinely unknown
  total: number;
  error?: string;
}

function emptyBreakdown(): TierBreakdown {
  return { standard: 0, gold: 0, platinum: 0, diamond: 0, vip: 0, mystery: 0, total: 0 };
}

interface BlockscoutInstance {
  metadata?: {
    name?: string;
    attributes?: { trait_type?: string; value?: string }[];
  } | null;
}

interface BlockscoutPage {
  items: BlockscoutInstance[];
  next_page_params: Record<string, string | number> | null;
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
          if (edition === "Standard") breakdown.standard += 1;
          else if (edition === "Gold") breakdown.gold += 1;
          else if (edition === "Platinum") breakdown.platinum += 1;
          else if (edition === "Diamond") breakdown.diamond += 1;
          else breakdown.mystery += 1; // unrecognized card edition — don't silently misprice it
        } else {
          breakdown.vip += 1;
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
