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

// The exact 3 collections CLAUDE.md's contract requirements mandate — one
// upgradable contract per chain, holding every track/album as its own
// tokenId (EVM) or verified mint (Solana), never one contract per
// track/album. `address` fills in once each one is actually deployed;
// deploy/upgrade tooling in /admin should be built against this exact list,
// not a generic "deploy any contract" flow.
export interface ContractTarget {
  key: "robinhood" | "base" | "solana";
  chainName: string;
  standard: string;
  address: string | null;
}

export const CONTRACT_TARGETS: ContractTarget[] = [
  { key: "robinhood", chainName: "Robinhood Chain", standard: "ERC-1155 (upgradable proxy)", address: null },
  { key: "base", chainName: "Base", standard: "ERC-1155 (upgradable proxy)", address: null },
  { key: "solana", chainName: "Solana", standard: "Metaplex Certified Collection", address: null },
];
