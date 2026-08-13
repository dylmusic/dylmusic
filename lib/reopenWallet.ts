// Real per-wallet universal links for bringing an already-open wallet app
// back to the foreground when a pending signature request seems stuck (the
// user dismissed the deep-link prompt, or the OS just didn't switch apps).
// This is NOT for starting a new connection — the wallet app is already
// running with this session's pending request, a universal link just
// re-foregrounds it, same mechanism MetaMask's own deep link out already
// uses. Only mapped for wallets with a verified, documented universal link
// (matching HOODPrinter's own robinhood-wallet:// deep link, sourced live
// from WalletConnect's Explorer API rather than guessed) — an unmapped
// connector id just gets no button rather than a link to somewhere wrong.
const REOPEN_URLS: Record<string, string> = {
  metaMaskSDK: "https://metamask.app.link/",
};

export function reopenWalletUrl(connectorId: string | undefined): string | null {
  if (!connectorId) return null;
  return REOPEN_URLS[connectorId] ?? null;
}
