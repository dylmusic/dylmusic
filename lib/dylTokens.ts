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
  key: "robinhood" | "base" | "solana" | "ethereum";
  name: string;
  enabled: boolean;
}

// Ethereum mainnet added as a 4th swap chain (parity with HOODPrinter's own
// /swap) — the wagmi/RainbowKit plumbing already existed (lib/web3.ts added
// mainnet to wagmiConfig.chains for the admin panel), this just makes it
// pickable in the token picker too.
export const SWAP_CHAINS: SwapChain[] = [
  { id: robinhoodChain.id, key: "robinhood", name: "Robinhood", enabled: true },
  { id: base.id, key: "base", name: "Base", enabled: true },
  { id: SOLANA_CHAIN_ID, key: "solana", name: "Solana", enabled: true },
  { id: mainnet.id, key: "ethereum", name: "Ethereum", enabled: true },
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

// More common tokens beyond the pinned row, per chain — parity with
// HOODPrinter's own MORE_BASE_TOKENS/MORE_SOLANA_TOKENS/MORE_MAINNET_TOKENS,
// same real addresses (Relay's /currencies/v2 `defaultList: true` response,
// `verified: true` only), not re-derived.
const USDT_BASE: DylToken = {
  chainId: base.id,
  address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
  symbol: "USDT",
  name: "Tether USD",
  decimals: 6,
  logo: "https://coin-images.coingecko.com/coins/images/39963/large/usdt.png",
};
const CBBTC_BASE: DylToken = {
  chainId: base.id,
  address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
  symbol: "cbBTC",
  name: "Coinbase Wrapped BTC",
  decimals: 8,
  logo: "https://coin-images.coingecko.com/coins/images/40143/large/cbbtc.webp",
};
const CBETH_BASE: DylToken = {
  chainId: base.id,
  address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
  symbol: "cbETH",
  name: "Coinbase Wrapped Staked ETH",
  decimals: 18,
  logo: "https://coin-images.coingecko.com/coins/images/27008/large/cbeth.png",
};
const AERO_BASE: DylToken = {
  chainId: base.id,
  address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
  symbol: "AERO",
  name: "Aerodrome",
  decimals: 18,
  logo: "https://coin-images.coingecko.com/coins/images/31745/large/token.png",
};
const VIRTUAL_BASE: DylToken = {
  chainId: base.id,
  address: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b",
  symbol: "VIRTUAL",
  name: "Virtual Protocol",
  decimals: 18,
  logo: "https://coin-images.coingecko.com/coins/images/34057/large/LOGOMARK.png",
};
const MORE_BASE_TOKENS: DylToken[] = [USDT_BASE, CBBTC_BASE, CBETH_BASE, AERO_BASE, VIRTUAL_BASE];

// Canonical WETH verified via Relay's own /currencies/v2 (term="WETH",
// chainId=1) — matches the well-known contract, not typed from memory.
const WETH_ETHEREUM: DylToken = {
  chainId: mainnet.id,
  address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  symbol: "WETH",
  name: "Wrapped Ether",
  decimals: 18,
  logo: "https://coin-images.coingecko.com/coins/images/39810/large/weth.png",
};
const USDC_ETHEREUM: DylToken = {
  chainId: mainnet.id,
  address: "0xA0b86991c6218b36c1D19D4a2e9Eb0cE3606eB48",
  symbol: "USDC",
  name: "USD Coin",
  decimals: 6,
  logo: "https://coin-images.coingecko.com/coins/images/6319/large/usdc.png",
};
const USDT_ETHEREUM: DylToken = {
  chainId: mainnet.id,
  address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  symbol: "USDT",
  name: "Tether USD",
  decimals: 6,
  logo: "https://coin-images.coingecko.com/coins/images/39963/large/usdt.png",
};
const DAI_ETHEREUM: DylToken = {
  chainId: mainnet.id,
  address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  symbol: "DAI",
  name: "Dai Stablecoin",
  decimals: 18,
  logo: "https://coin-images.coingecko.com/coins/images/9956/large/Badge_Dai.png",
};
const WBTC_ETHEREUM: DylToken = {
  chainId: mainnet.id,
  address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
  symbol: "WBTC",
  name: "Wrapped BTC",
  decimals: 8,
  logo: "https://coin-images.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png",
};
const MORE_ETHEREUM_TOKENS: DylToken[] = [WETH_ETHEREUM, USDC_ETHEREUM, USDT_ETHEREUM, DAI_ETHEREUM, WBTC_ETHEREUM];

const USDT_SOLANA: DylToken = {
  chainId: SOLANA_CHAIN_ID,
  address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  symbol: "USDT",
  name: "USDT",
  decimals: 6,
  logo: "https://coin-images.coingecko.com/coins/images/325/large/Tether.png",
};
const PYUSD_SOLANA: DylToken = {
  chainId: SOLANA_CHAIN_ID,
  address: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
  symbol: "PYUSD",
  name: "PayPal USD",
  decimals: 6,
  logo: "https://coin-images.coingecko.com/coins/images/31212/large/PYUSD_Logo_%282%29.png",
};
const CBBTC_SOLANA: DylToken = {
  chainId: SOLANA_CHAIN_ID,
  address: "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij",
  symbol: "cbBTC",
  name: "Coinbase Wrapped BTC",
  decimals: 8,
  logo: "https://coin-images.coingecko.com/coins/images/40143/large/cbbtc.webp",
};
const MORE_SOLANA_TOKENS: DylToken[] = [USDT_SOLANA, PYUSD_SOLANA, CBBTC_SOLANA];

export const PINNED_TOKENS: Record<"robinhood" | "base" | "solana" | "ethereum", DylToken[]> = {
  robinhood: [ETH_ROBINHOOD, WETH_ROBINHOOD, USDG_ROBINHOOD],
  base: [ETH_BASE, WETH_BASE, USDC_BASE],
  solana: [SOL_NATIVE, USDC_SOLANA, USDG_SOLANA],
  // WETH added alongside ETH — it had nothing else pinned before this.
  ethereum: [ETH_ETHEREUM, WETH_ETHEREUM],
};

export const CURATED_TOKENS: DylToken[] = [
  ETH_ROBINHOOD,
  WETH_ROBINHOOD,
  USDG_ROBINHOOD,
  ETH_BASE,
  WETH_BASE,
  USDC_BASE,
  ...MORE_BASE_TOKENS,
  SOL_NATIVE,
  USDC_SOLANA,
  USDG_SOLANA,
  ...MORE_SOLANA_TOKENS,
  ETH_ETHEREUM,
  ...MORE_ETHEREUM_TOKENS,
];

export function isSolanaChain(chainId: number): boolean {
  return chainId === SOLANA_CHAIN_ID;
}

/**
 * Symbol -> chain id, for shareable swap links (?from=SYMBOL&to=SYMBOL,
 * optional &fromChain=/&toChain= to disambiguate a symbol that exists on
 * more than one chain, e.g. "eth"/"weth"/"usdc"/"usdt"). Accepts either a
 * chain's display name ("Solana", case-insensitive) or its raw numeric id.
 * Parity with HOODPrinter's own chainIdFromParam.
 */
export function chainIdFromParam(param: string): number | undefined {
  const p = param.trim().toLowerCase();
  const byName = SWAP_CHAINS.find((c) => c.name.toLowerCase() === p);
  if (byName) return byName.id;
  const asNum = Number(p);
  return SWAP_CHAINS.some((c) => c.id === asNum) ? asNum : undefined;
}

/**
 * Looks up a curated token by symbol (case-insensitive) for shareable swap
 * links — e.g. /swap?to=usdg. `chainId`, when given, disambiguates a symbol
 * that exists on more than one chain; without it, the first match in
 * CURATED_TOKENS wins (Robinhood Chain for every symbol native to this
 * site). Returns undefined for an unknown symbol rather than guessing.
 * Parity with HOODPrinter's own findTokenBySymbol.
 */
export function findTokenBySymbol(symbol: string, chainId?: number): DylToken | undefined {
  const s = symbol.trim().toLowerCase();
  if (!s) return undefined;
  return CURATED_TOKENS.find((t) => t.symbol.toLowerCase() === s && (chainId === undefined || t.chainId === chainId));
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

// Custom-paste detection: EVM chains look for a "0x..." address; Solana
// mint addresses are base58 (no 0/O/I/l), typically 32-44 chars, with no
// distinguishing prefix — length+charset is the best available heuristic
// short of attempting a resolve on every keystroke. Parity with
// HOODPrinter's own looksLikeAddress (was inlined in TokenPickerModal.tsx
// there; exported from here so both /swap's picker and the NFT buy-confirm
// picker can share one implementation).
// Split into two standalone checks (not just the chain-aware wrapper below)
// so shareable swap links (?to=0x.../?to=<base58 mint>) can auto-detect
// which chain an address belongs to when the link doesn't say — parity
// with HOODPrinter's own looksLikeEvmAddress/looksLikeSolanaAddress.
export function looksLikeEvmAddress(q: string): boolean {
  return q.length >= 8 && /^0x/i.test(q);
}
export function looksLikeSolanaAddress(q: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q);
}
export function looksLikeAddress(chainId: number, q: string): boolean {
  return isSolanaChain(chainId) ? looksLikeSolanaAddress(q) : looksLikeEvmAddress(q);
}

// Public read RPCs per EVM chain — read-only calls (symbol/name/decimals)
// only, never used for signing/sending. A pasted MAINNET address used to
// silently resolve against BASE's RPC (this file's old `chainId ===
// robinhoodChain.id ? robinhoodChain : base` fallback) — a real bug, found
// while porting HOODPrinter's own per-chain resolveCustomToken over.
const EVM_RPC_URLS: Record<number, string> = {
  [robinhoodChain.id]: "https://rpc.mainnet.chain.robinhood.com",
  [base.id]: "https://mainnet.base.org",
  [mainnet.id]: "https://eth.llamarpc.com",
};
const EVM_CHAINS = { [robinhoodChain.id]: robinhoodChain, [base.id]: base, [mainnet.id]: mainnet } as const;

// Resolves a pasted address not in the curated list, for the given chain.
// EVM chains read symbol/name/decimals directly on-chain, same "add by CA"
// pattern as HOODPrinter's PrintBot/robinhoodTokens.ts, plus a live logo
// lookup. Solana has no on-chain SPL name/symbol standard to read the same
// way (that's Metaplex metadata, a separate program) — trusts Relay's own
// /currencies/v2 address lookup alone, returns null (curated-list-only) if
// Relay doesn't recognize the mint, rather than guessing.
export async function resolveCustomToken(chainId: number, address: string): Promise<DylToken | null> {
  const known = CURATED_TOKENS.find(
    (t) => t.chainId === chainId && t.address.toLowerCase() === address.toLowerCase()
  );
  if (known) return known;

  if (isSolanaChain(chainId)) {
    try {
      const res = await fetch("https://api.relay.link/currencies/v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chainIds: [chainId], address }),
      });
      const results = await res.json();
      const r = results?.[0];
      if (!r?.symbol || !r?.decimals) return null;
      return { chainId, address, symbol: r.symbol, name: r.name || r.symbol, decimals: Number(r.decimals), logo: r.metadata?.logoURI };
    } catch {
      return null;
    }
  }

  if (!isAddress(address)) return null;
  const checksummed = getAddress(address);
  const chain = EVM_CHAINS[chainId as keyof typeof EVM_CHAINS];
  const rpcUrl = EVM_RPC_URLS[chainId];
  if (!chain || !rpcUrl) return null;
  try {
    const client = createPublicClient({ chain, transport: http(rpcUrl) });
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
