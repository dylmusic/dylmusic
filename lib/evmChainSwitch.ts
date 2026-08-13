import { UserRejectedRequestError, type WalletClient } from "viem";
import { getWalletClient } from "wagmi/actions";
import { ConnectorChainMismatchError } from "wagmi";
import { wagmiConfig } from "./web3";

// Switches the connected EVM wallet to `chainId` and returns a FRESH wallet
// client scoped to it — never the stale reactive `useWalletClient()` value,
// which doesn't reflect a switch made earlier in the same function call.
//
// Real bug hit live on mobile Safari + MetaMask (2026-08-13, a Robinhood
// Chain NFT purchase): Robinhood Chain isn't a chain MetaMask already knows
// about, so its SDK connector has to go through `wallet_addEthereumChain`
// then `wallet_switchEthereumChain` — each its own full deep-link round
// trip out to the MetaMask app and back to Safari. The connector's own
// post-switch confirmation poll (`waitForChainIdToSync` in
// @wagmi/connectors' metaMask.ts) only retries `eth_chainId` for ~1 second
// (20 * 50ms) before giving up and throwing "User rejected switch after
// adding network" — nowhere near enough time for a real user to manually
// tap "Return to app" on iOS, which this codebase's other mobile deep-link
// flows (see AddToMetaMask in hoodprinter, and CLAUDE.md's own notes on
// mobile round-trip latency) have already found to be genuinely slow. The
// wallet's chain has usually actually finished switching a moment later —
// retrying the whole `switchChainAsync` call (not just `getWalletClient`)
// picks that up for free, since a chain that's already added+active
// resolves the next `wallet_switchEthereumChain` call immediately with no
// new deep link. A real user rejection (`UserRejectedRequestError`) is
// left alone and rethrown immediately — no point retrying a genuine "no."
export async function ensureEvmChain(
  switchChainAsync: (args: { chainId: number }) => Promise<unknown>,
  chainId: number
): Promise<WalletClient> {
  for (let switchAttempt = 0; ; switchAttempt++) {
    try {
      await switchChainAsync({ chainId });
      break;
    } catch (e) {
      if (e instanceof UserRejectedRequestError || switchAttempt >= 5) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  for (let attempt = 0; ; attempt++) {
    try {
      return await getWalletClient(wagmiConfig, { chainId });
    } catch (e) {
      if (attempt >= 5 || !(e instanceof ConnectorChainMismatchError)) throw e;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}
