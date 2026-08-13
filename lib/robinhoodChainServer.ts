import type { Chain } from "viem";

// A minimal, server-safe Robinhood Chain definition for API routes
// (app/api/burn/*, lib/burnLedgerStore.ts, lib/burnClaimSigner.ts) —
// deliberately NOT importing lib/web3.ts's robinhoodChain or
// lib/dylSwap.ts's EVM_CHAINS/EVM_RPC_URLS, both of which transitively
// pull in RainbowKit/the Relay SDK/client-only Solana wallet code and
// broke Next.js's server-side "collect page data" build step when
// imported from a real API route (confirmed: a clean build failed with a
// cryptic "is not a function" error the moment burnLedgerStore.ts imported
// lib/dylSwap.ts, and succeeded again once swapped to this instead).
export const ROBINHOOD_CHAIN_SERVER: Chain = {
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
};

export const ROBINHOOD_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
