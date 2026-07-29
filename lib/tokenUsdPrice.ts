import { robinhoodChain } from "./web3";
import { base, mainnet } from "wagmi/chains";
import { SOLANA_CHAIN_ID, isSolanaChain, type DylToken } from "./dylTokens";

/**
 * Per-token USD price — needed to convert an NFT edition's fixed USD price
 * into an exact `payToken` input amount for the any-token-to-NFT flow
 * (lib/useTrackCommerce.ts). Same DexScreener pattern HOODPrinter's own
 * swap uses (lib/tokenUsdPrice.ts there) for its "≈ $X" display and
 * mismatch warning — ported here since dylmusic had no live USD pricing
 * anywhere before this (Track.priceUsd is static catalog data, not a rate).
 */
const DEXSCREENER_CHAIN_SLUG: Record<number, string> = {
  [robinhoodChain.id]: "robinhood",
  [base.id]: "base",
  [mainnet.id]: "ethereum",
  [SOLANA_CHAIN_ID]: "solana",
};

// Native assets have no DexScreener "base token" pair of their own —
// queried via their wrapped/canonical form instead, same trick HOODPrinter
// uses for native SOL (DexScreener indexes the wrapped mint, not Relay's
// "1111...1111" native sentinel).
const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const WETH_BY_CHAIN: Record<number, string> = {
  [robinhoodChain.id]: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  [base.id]: "0x4200000000000000000000000000000000000006",
  [mainnet.id]: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
};

export async function getTokenUsdPrice(token: DylToken): Promise<number | null> {
  const isNativeSol = token.isNative && isSolanaChain(token.chainId);
  const queryAddress = isNativeSol
    ? WRAPPED_SOL_MINT
    : token.isNative
      ? WETH_BY_CHAIN[token.chainId]
      : token.address;
  const slug = DEXSCREENER_CHAIN_SLUG[token.chainId];
  if (!queryAddress || !slug) return null;
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${queryAddress}`);
    const json = await res.json();
    const pairs = (json?.pairs || []).filter(
      (p: { chainId?: string; baseToken?: { address?: string } }) =>
        p.chainId === slug && p.baseToken?.address?.toLowerCase() === queryAddress.toLowerCase()
    );
    if (!pairs.length) return null;
    const best = pairs.sort(
      (a: { liquidity?: { usd?: number } }, b: { liquidity?: { usd?: number } }) =>
        (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
    )[0];
    const price = Number(best.priceUsd);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}
