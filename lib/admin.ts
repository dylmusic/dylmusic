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
