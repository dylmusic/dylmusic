import type { WalletClient } from "viem";
import type { AdaptedWallet } from "@reservoir0x/relay-sdk";
import { ChainKey } from "./albums";
import { chainIdForKey, getNativeTokenForChain, isSolanaChain, type DylToken } from "./dylTokens";
import { getSwapQuote, executeSwap, waitForBalanceIncrease, getNativeBalanceWei, quoteLastTxHash, relayTransactionUrl } from "./dylSwap";
import { getTokenUsdPrice } from "./tokenUsdPrice";

/**
 * The real engine behind "pay for an NFT with any token on any chain" —
 * same shape as HOODPrinter's own relay-to-print plan (any origin token →
 * native ETH on the target chain via Relay → our own second leg), just with
 * an NFT purchase instead of a $PRINT-pool buy on that second leg. Shared
 * by both the single-track buy-confirm modal and the whole-album sweep
 * buy (AlbumView.tsx) so this fund-moving logic exists in exactly one
 * place — same reasoning HOODPrinter's own runPrintBuyLeg2 sharing already
 * follows.
 *
 * NOT WIRED TO THE LIVE "Confirm Buy" BUTTON YET — the final on-chain
 * purchase step is still simulated (no NFT contract is deployed), and per
 * Dylan's explicit call, real money should never move for a purchase that
 * can't actually complete. The "🚧 Not live yet" gate in
 * BuyConfirmModal.tsx / AlbumView.tsx fires BEFORE this function is ever
 * called, so today it's dead code — fully built and type-checked, ready to
 * wire in with a one-line change (swap the `setNotLive(true)` call for
 * `runPayWithAnyToken(...)`) the moment real contracts go live.
 */

export type PayStep = { part: number; total: number; label: string } | null;

export interface PayWithAnyTokenParams {
  payToken: DylToken;
  targetChain: ChainKey;
  totalUsd: number;
  onStep: (step: PayStep) => void;
  // Caller-supplied capabilities — kept as plain params (not hooks called
  // in here) so this stays a plain importable function usable from any
  // component, each supplying its own wagmi/Phantom instances.
  ensureEvmChain: (chainId: number) => Promise<WalletClient>;
  adaptEvm: (client: WalletClient) => AdaptedWallet;
  getSolanaWallet: () => { address: string | null; adapt: () => AdaptedWallet | null };
  evmAddress: string | null;
}

export interface PayWithAnyTokenResult {
  ok: boolean;
  relayUrl: string | null;
  txHash: string | null;
}

function isSameToken(a: DylToken, b: DylToken) {
  return a.chainId === b.chainId && a.address.toLowerCase() === b.address.toLowerCase();
}

/**
 * Runs whatever real steps are needed to get `payToken` into native
 * currency on `targetChain`, landed in the buyer's own wallet there.
 * Returns once that's done — the caller is responsible for the FINAL
 * purchase/mint step (this function never touches NFT contract calldata
 * itself, since that shape depends on which chain and isn't this module's
 * concern). Step count is dynamic: native pay token needs no swap at all
 * (caller should skip calling this entirely in that case — see
 * isNativePayToken below); same-chain swap is 2 steps (swap, then the
 * caller's own final step); cross-chain is 3 (swap/bridge-submit, bridge-
 * wait, then the caller's own final step) — matching the "1/3 2/3 3/3"
 * shape Dylan asked for on the flagship cross-chain case.
 */
export function isNativePayToken(payToken: DylToken, targetChain: ChainKey): boolean {
  return isSameToken(payToken, getNativeTokenForChain(targetChain));
}

export async function runPayWithAnyToken(params: PayWithAnyTokenParams): Promise<PayWithAnyTokenResult> {
  const { payToken, targetChain, totalUsd, onStep, ensureEvmChain, adaptEvm, getSolanaWallet, evmAddress } = params;
  const targetChainId = chainIdForKey(targetChain);
  const targetNative = getNativeTokenForChain(targetChain);
  const targetIsSolana = isSolanaChain(targetChainId);
  const payIsSolana = isSolanaChain(payToken.chainId);
  const sol = getSolanaWallet();

  if (isNativePayToken(payToken, targetChain)) {
    // Nothing to swap — the caller's own final step is the whole flow.
    return { ok: true, relayUrl: null, txHash: null };
  }

  const price = await getTokenUsdPrice(payToken);
  if (!price) throw new Error(`Could not price ${payToken.symbol} right now — try again shortly.`);
  const payAmount = totalUsd / price;
  if (!(payAmount > 0)) throw new Error("Could not compute a valid swap amount.");
  const amountWei = BigInt(Math.round(payAmount * 10 ** payToken.decimals));

  const crossChain = payToken.chainId !== targetChainId;
  const total = crossChain ? 3 : 2;

  const targetRecipientAddress = targetIsSolana ? sol.address : evmAddress;
  const originUserAddress = payIsSolana ? sol.address : evmAddress;
  if (!originUserAddress || !targetRecipientAddress) throw new Error("Missing a required wallet address.");

  onStep({ part: 1, total, label: `Confirm ${payToken.symbol} → ${targetNative.symbol}` });

  const quote = await getSwapQuote({
    chainId: payToken.chainId,
    toChainId: targetChainId,
    fromCurrency: payToken.address,
    toCurrency: targetNative.address,
    amountWei: amountWei.toString(),
    userAddress: originUserAddress,
    recipientAddress: targetRecipientAddress,
    chargeFee: true,
  });

  let wallet: AdaptedWallet;
  if (payIsSolana) {
    const adapted = sol.adapt();
    if (!adapted) throw new Error("Phantom wallet not found.");
    wallet = adapted;
  } else {
    const client = await ensureEvmChain(payToken.chainId);
    wallet = adaptEvm(client);
  }

  // Snapshot BEFORE executing — the cross-chain bridge-wait below needs a
  // real "did it land" comparison point, same technique HOODPrinter's own
  // waitForBalanceIncrease uses.
  const preBalanceWei = crossChain ? await getNativeBalanceWei(targetChainId, targetRecipientAddress, targetIsSolana) : null;

  const { data: result } = await executeSwap(quote, wallet, (p) => onStep({ part: 1, total, label: p.label }));
  const relayUrl = relayTransactionUrl(result);
  const txHash = quoteLastTxHash(result, payToken.chainId);

  if (crossChain) {
    onStep({ part: 2, total, label: "Checking for bridge…" });
    const received = await waitForBalanceIncrease(targetChainId, targetRecipientAddress, preBalanceWei!, {
      isSolana: targetIsSolana,
      onTick: (ms) => onStep({ part: 2, total, label: `Checking for bridge… (${Math.round(ms / 1000)}s)` }),
    });
    if (received <= BigInt(0)) {
      throw new Error(`${payToken.symbol} → ${targetNative.symbol} did not land yet — please try again shortly.`);
    }
  }

  onStep({ part: total, total, label: "Confirm purchase" });
  return { ok: true, relayUrl, txHash };
}
