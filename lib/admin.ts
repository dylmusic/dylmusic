// Single source of truth for who can see /admin — checked both client-side
// (to gate the page UI) and server-side (to gate the one real destructive
// action wired up so far, deleting a chat message). This is a simple
// address match, not a signature check, so it's only as strong as trusting
// a self-reported wallet address — fine for low-stakes moderation today,
// but anything that moves real funds later (contract deploys, fee
// withdrawals) will need real server-side signature verification first.
export const ADMIN_WALLET = "0x9e0149f7CC28c93A3B5F76AB3e8A2a22d14435b5";

export function isAdminWallet(address?: string | null): boolean {
  return !!address && address.toLowerCase() === ADMIN_WALLET.toLowerCase();
}

// The collections CLAUDE.md's contract requirements mandate — one
// upgradable contract per chain, holding every track/album as its own
// tokenId (EVM, partitioned ranges under ERC721A — see CLAUDE.md "Contract
// Requirement", decided 2026-07-28, NOT ERC-1155) or verified mint
// (Solana), never one contract per track/album. `address` fills in once
// each one is actually deployed; deploy/upgrade tooling in /admin should be
// built against this exact list, not a generic "deploy any contract" flow.
//
// `order`/`reason` exist so /admin can render one unambiguous deployment
// sequence instead of an unordered list — Dylan asked for this directly
// ("give a clear order of deployment on admin panel, make it super easy
// for me"). The marketplace entry is last and explicitly optional: per the
// "Our own marketplace contract" section in CLAUDE.md, real ownership/sales
// through the collection contracts above already show up correctly on
// OpenSea on their own — a dedicated marketplace contract is only needed if
// that turns out insufficient (e.g. wanting "Buy Now" inside OpenSea's own
// UI too, which needs a real Seaport order, not just this), so it is
// deliberately NOT required to ship the collections themselves and comes
// after them since it would need to reference real deployed collections.
export interface ContractTarget {
  key: "robinhood" | "base" | "ethereum" | "solana" | "marketplace";
  order: number;
  chainName: string;
  standard: string;
  address: string | null;
  reason: string;
  optional?: boolean;
}

export const CONTRACT_TARGETS: ContractTarget[] = [
  {
    key: "robinhood",
    order: 1,
    chainName: "Robinhood Chain",
    standard: "ERC721A (upgradable proxy)",
    address: null,
    reason: "Home chain — the flagship collection, deploy first.",
  },
  {
    key: "base",
    order: 2,
    chainName: "Base",
    standard: "ERC721A (upgradable proxy)",
    address: null,
    reason: "Second EVM chain, same contract shape as Robinhood Chain.",
  },
  {
    key: "ethereum",
    order: 3,
    chainName: "Ethereum",
    standard: "ERC721A (upgradable proxy)",
    address: null,
    reason: "Added 2026-07-28 (gas is cheap enough now) — same shape again, third EVM deploy.",
  },
  {
    key: "solana",
    order: 4,
    chainName: "Solana",
    standard: "Metaplex Certified Collection",
    address: null,
    reason: "Different VM/tooling than the 3 EVM deploys above — do it once they're a known-working pattern.",
  },
  {
    key: "marketplace",
    order: 5,
    chainName: "All chains",
    standard: "Custom order-book / listing contract",
    address: null,
    optional: true,
    reason: "Optional — only build if OpenSea's own Seaport listing flow turns out insufficient. Needs the 4 collections above to already exist, since it references real tokens on them.",
  },
];
