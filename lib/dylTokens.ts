import { createPublicClient, http, isAddress, getAddress } from "viem";
import { robinhoodChain } from "./web3";
import { base, mainnet } from "wagmi/chains";
import type { ChainKey } from "./albums";

// Curated token list for the real Swap page — same "Select Token" pattern
// as HOODPrinter's /swap, rebranded and generalized (no single token's pool
// needs protecting here, so every swap is just a plain Relay-routed leg).

export const NATIVE_ETH = "0x0000000000000000000000000000000000000000";
export const SOLANA_CHAIN_ID = 792703809; // Relay's own id for Solana, not a real EVM chain id

export interface SwapChain {
  id: number;
  key: "robinhood" | "base" | "solana";
  name: string;
  enabled: boolean;
}

export const SWAP_CHAINS: SwapChain[] = [
  { id: robinhoodChain.id, key: "robinhood", name: "Robinhood", enabled: true },
  { id: base.id, key: "base", name: "Base", enabled: true },
  { id: SOLANA_CHAIN_ID, key: "solana", name: "Solana", enabled: true },
];

// Relay's own sentinel address for native SOL (Solana's System Program id —
// verified live against Relay's /currencies/v2 API, not guessed).
export const NATIVE_SOL = "11111111111111111111111111111111";

export interface DylToken {
  chainId: number;
  address: string; // NATIVE_ETH (or "native" for Solana) marks the chain's own asset
  symbol: string;
  name: string;
  decimals: number;
  logo?: string;
  isNative?: boolean;
}

const ETH_ROBINHOOD: DylToken = {
  chainId: robinhoodChain.id,
  address: NATIVE_ETH,
  symbol: "ETH",
  name: "Ethereum",
  decimals: 18,
  isNative: true,
};

const ETH_BASE: DylToken = {
  chainId: base.id,
  address: NATIVE_ETH,
  symbol: "ETH",
  name: "Ethereum",
  decimals: 18,
  isNative: true,
};

// Ethereum mainnet added 2026-07-28 as a site chain — just the native asset
// for now (same minimal shape as the other two), not a full WETH/USDC pair
// list; the real Swap page's own multi-token picker (SWAP_CHAINS below) is
// a separate, bigger question not touched by this.
const ETH_ETHEREUM: DylToken = {
  chainId: mainnet.id,
  address: NATIVE_ETH,
  symbol: "ETH",
  name: "Ethereum",
  decimals: 18,
  isNative: true,
};

// Verified real addresses (same chain infra HOODPrinter's own /swap already
// documents/uses) — WETH + USDG on Robinhood Chain, WETH + USDC on Base.
const WETH_ROBINHOOD: DylToken = {
  chainId: robinhoodChain.id,
  address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  symbol: "WETH",
  name: "WETH",
  decimals: 18,
  logo: "https://coin-images.coingecko.com/coins/images/102174283/large/weth-robinhood.jpeg?1782924507",
};

const USDG_ROBINHOOD: DylToken = {
  chainId: robinhoodChain.id,
  address: "0x5FC5360D0400a0Fd4f2AF552Add042d716f1D168",
  symbol: "USDG",
  name: "Global Dollar",
  decimals: 6,
  logo: "https://assets.coingecko.com/coins/images/51281/standard/GDN_USDG_Token_200x200.png",
};

const WETH_BASE: DylToken = {
  chainId: base.id,
  address: "0x4200000000000000000000000000000000000006",
  symbol: "WETH",
  name: "WETH",
  decimals: 18,
  logo: "https://coin-images.coingecko.com/coins/images/2518/large/weth.png",
};

const USDC_BASE: DylToken = {
  chainId: base.id,
  address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  symbol: "USDC",
  name: "USD Coin",
  decimals: 6,
  logo: "https://coin-images.coingecko.com/coins/images/6319/large/usdc.png",
};

// Verified live via Relay's /currencies/v2 API for chainId 792703809 (Solana).
const SOL_NATIVE: DylToken = {
  chainId: SOLANA_CHAIN_ID,
  address: NATIVE_SOL,
  symbol: "SOL",
  name: "Solana",
  decimals: 9,
  isNative: true,
  logo: "https://upload.wikimedia.org/wikipedia/en/b/b9/Solana_logo.png",
};

const USDC_SOLANA: DylToken = {
  chainId: SOLANA_CHAIN_ID,
  address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  symbol: "USDC",
  name: "USD Coin",
  decimals: 6,
  logo: "https://coin-images.coingecko.com/coins/images/6319/large/usdc.png",
};

const USDG_SOLANA: DylToken = {
  chainId: SOLANA_CHAIN_ID,
  address: "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH",
  symbol: "USDG",
  name: "Global Dollar",
  decimals: 6,
  logo: "https://coin-images.coingecko.com/coins/images/51281/large/GDN_USDG_Token_200x200.png",
};

export const PINNED_TOKENS: Record<"robinhood" | "base" | "solana" | "ethereum", DylToken[]> = {
  robinhood: [ETH_ROBINHOOD, WETH_ROBINHOOD, USDG_ROBINHOOD],
  base: [ETH_BASE, WETH_BASE, USDC_BASE],
  solana: [SOL_NATIVE, USDC_SOLANA, USDG_SOLANA],
  ethereum: [ETH_ETHEREUM],
};

export const CURATED_TOKENS: DylToken[] = [
  ETH_ROBINHOOD,
  WETH_ROBINHOOD,
  USDG_ROBINHOOD,
  ETH_BASE,
  WETH_BASE,
  USDC_BASE,
  SOL_NATIVE,
  USDC_SOLANA,
  USDG_SOLANA,
];

export function isSolanaChain(chainId: number): boolean {
  return chainId === SOLANA_CHAIN_ID;
}

export function chainIdForKey(chain: ChainKey): number {
  if (chain === "base") return base.id;
  if (chain === "solana") return SOLANA_CHAIN_ID;
  if (chain === "ethereum") return mainnet.id;
  return robinhoodChain.id;
}

// The site's own chain selector (robinhood/base/solana) picks which native
// asset a buy defaults to paying with — the same tokens the real Swap page
// already curates, just looked up by our own ChainKey instead of a raw id.
export function getNativeTokenForChain(chain: ChainKey): DylToken {
  return PINNED_TOKENS[chain][0];
}

const erc20MetaAbi = [
  { name: "symbol", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { name: "name", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

async function fetchRelayTokenLogo(chainId: number, address: string): Promise<string | undefined> {
  try {
    const res = await fetch("https://api.relay.link/currencies/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chainIds: [chainId], address }),
    });
    const results = await res.json();
    return results?.[0]?.metadata?.logoURI || undefined;
  } catch {
    return undefined;
  }
}

// Resolves a pasted contract address not in the curated list, reading
// symbol/name/decimals on-chain directly (same "add by CA" pattern as
// HOODPrinter's PrintBot/robinhoodTokens.ts), plus a live logo lookup.
export async function resolveCustomToken(chainId: number, address: string): Promise<DylToken | null> {
  if (chainId === SOLANA_CHAIN_ID) return null; // SPL mint metadata isn't resolved yet — curated list only
  if (!isAddress(address)) return null;
  const checksummed = getAddress(address);
  const known = CURATED_TOKENS.find(
    (t) => t.chainId === chainId && t.address.toLowerCase() === checksummed.toLowerCase()
  );
  if (known) return known;

  const chain = chainId === robinhoodChain.id ? robinhoodChain : base;
  try {
    const client = createPublicClient({ chain, transport: http() });
    const [symbol, name, decimals, logo] = await Promise.all([
      client.readContract({ address: checksummed, abi: erc20MetaAbi, functionName: "symbol" }),
      client.readContract({ address: checksummed, abi: erc20MetaAbi, functionName: "name" }),
      client.readContract({ address: checksummed, abi: erc20MetaAbi, functionName: "decimals" }),
      fetchRelayTokenLogo(chainId, checksummed),
    ]);
    return { chainId, address: checksummed, symbol, name, decimals: Number(decimals), logo };
  } catch {
    return null;
  }
}
