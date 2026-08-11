import { createPublicClient, http, type Chain } from "viem";

// A deliberately minimal, self-contained set of chain definitions for
// SERVER-SIDE reads only (API routes) — do NOT import lib/dylSwap.ts's
// EVM_CHAINS/EVM_RPC_URLS here. Real bug hit building this: pulling
// `base`/`mainnet` from `wagmi/chains` (which lib/dylSwap.ts and
// lib/web3.ts both do, fine for client bundles) into a Next.js Route
// Handler broke the server build outright — `wagmi/chains`' barrel drags in
// viem's full chain list including a `tempo` chain definition whose own
// transitive dependency (`ox`'s `VirtualMaster`) has a
// "Critical dependency: the request of a dependency is an expression"
// webpack warning that becomes a real `TypeError: az is not a function` at
// server-side "Collecting page data" time — client bundles tolerate this,
// the Node.js route-handler bundle does not. A public client only actually
// needs `id`/`nativeCurrency` plus the explicit `transport: http(rpcUrl)`
// already passed in — none of the rest of a full Chain definition
// (block explorers, ENS, etc.) is used for a plain readContract call, so
// these are hand-written instead of imported from any package's chain list.

const ROBINHOOD_CHAIN: Chain = {
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
};

const BASE_CHAIN: Chain = {
  id: 8453,
  name: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://mainnet.base.org"] } },
};

const MAINNET_CHAIN: Chain = {
  id: 1,
  name: "Ethereum",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://eth.llamarpc.com"] } },
};

const SERVER_EVM_CHAINS: Record<number, { chain: Chain; rpcUrl: string }> = {
  [ROBINHOOD_CHAIN.id]: { chain: ROBINHOOD_CHAIN, rpcUrl: ROBINHOOD_CHAIN.rpcUrls.default.http[0] },
  [BASE_CHAIN.id]: { chain: BASE_CHAIN, rpcUrl: BASE_CHAIN.rpcUrls.default.http[0] },
  [MAINNET_CHAIN.id]: { chain: MAINNET_CHAIN, rpcUrl: MAINNET_CHAIN.rpcUrls.default.http[0] },
};

/** Read-only viem client for server routes only — see the file-level comment for why this doesn't reuse lib/dylSwap.ts's EVM_CHAINS. */
export function serverPublicClientFor(chainId: number) {
  const entry = SERVER_EVM_CHAINS[chainId];
  if (!entry) return null;
  return createPublicClient({ chain: entry.chain, transport: http(entry.rpcUrl) });
}
