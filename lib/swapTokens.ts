import { ChainKey } from "./albums";
import { DylToken, NATIVE_ETH, SOLANA_CHAIN_ID } from "./dylTokens";
import { robinhoodChain } from "./web3";
import { base } from "wagmi/chains";

// Cosmetic "Pay With" token list for the buy-confirmation popup — NFT
// purchases aren't wired to any real payment yet (nothing's actually for
// sale), so this stays a plain curated list rather than a live-resolved
// one. Shares DylToken's shape with lib/dylTokens.ts so the same
// TokenPickerModal UI can render either.

function chainIdFor(chain: ChainKey): number {
  if (chain === "base") return base.id;
  if (chain === "solana") return SOLANA_CHAIN_ID;
  return robinhoodChain.id;
}

function nativeToken(chain: ChainKey): DylToken {
  if (chain === "solana") {
    return { chainId: chainIdFor(chain), symbol: "SOL", name: "Solana", address: "native", decimals: 9, isNative: true };
  }
  return {
    chainId: chainIdFor(chain),
    symbol: "ETH",
    name: "Ethereum",
    address: NATIVE_ETH,
    decimals: 18,
    isNative: true,
  };
}

function usdc(chain: ChainKey): DylToken {
  return {
    chainId: chainIdFor(chain),
    symbol: "USDC",
    name: "USD Coin",
    address: `usdc-${chain}`,
    decimals: 6,
    logo: "https://coin-images.coingecko.com/coins/images/6319/large/usdc.png",
  };
}

export const CURATED_PAY_TOKENS: Record<ChainKey, DylToken[]> = {
  robinhood: [nativeToken("robinhood"), usdc("robinhood")],
  base: [nativeToken("base"), usdc("base")],
  solana: [nativeToken("solana"), usdc("solana")],
};

export function getNativePayToken(chain: ChainKey): DylToken {
  return CURATED_PAY_TOKENS[chain][0];
}

export function isNativePayToken(t: DylToken): boolean {
  return t.address === "native" || t.address === NATIVE_ETH;
}
