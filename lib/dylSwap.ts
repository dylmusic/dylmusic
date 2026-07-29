import {
  createClient,
  getQuote,
  execute,
  adaptViemWallet,
  convertViemChainToRelayChain,
  type Execute,
  type AdaptedWallet,
  type RelayChain,
} from "@reservoir0x/relay-sdk";
import { adaptSolanaWallet } from "@reservoir0x/relay-svm-wallet-adapter";
import { Connection, type VersionedTransaction, type SendOptions, type TransactionInstruction } from "@solana/web3.js";
import { createPublicClient, http, type WalletClient } from "viem";
import { robinhoodChain } from "./web3";
import { base, mainnet } from "wagmi/chains";
import { SOLANA_CHAIN_ID, NATIVE_SOL } from "./dylTokens";
import { ADMIN_WALLET } from "./admin";
import { getSolanaBalance } from "./solana";

// Headless Relay SDK usage — same package HOODPrinter's own /swap uses
// directly instead of the pre-built widget. Brought up to parity with
// HOODPrinter's own later cross-chain upgrade (2026-07-28): a real 0.85%
// fee, per-leg step progress (Relay can silently split a quote into more
// than one wallet prompt — an ERC20 origin needing an approve step before
// its swap step), a live "waiting for bridge" balance-poll, and Relay
// transaction links. dylmusic was originally the reference implementation
// for HOODPrinter's Solana wallet integration; this brings the newer
// robustness fixes back the other way.

const APP_FEE_BPS = "85";
// Same wallet as HOODPrinter's own RELAY_FEE_RECIPIENT — Dylan's real
// admin/owner address, already used that way elsewhere in this repo
// (lib/admin.ts), not a new wallet.
export const DYL_FEE_RECIPIENT = ADMIN_WALLET;

const SOLANA_RPC_URL = "https://solana-rpc.publicnode.com";

let clientReadyPromise: Promise<void> | null = null;

// `createClient({chains})` accepts the exact shape Relay's own /chains API
// returns (RelayChain is literally typed off that response) — fetching
// Solana's real entry live avoids hand-authoring chain metadata that could
// be wrong. Robinhood Chain needs explicit registration because it's not
// in the SDK's baked-in defaults (same "Unable to find chain" bug
// HOODPrinter's own /swap hit and fixed); Base and mainnet likely already
// are, but registering all four explicitly removes the guesswork.
async function ensureRelayClient(): Promise<void> {
  if (!clientReadyPromise) {
    clientReadyPromise = (async () => {
      let solanaChain: RelayChain | undefined;
      try {
        const res = await fetch("https://api.relay.link/chains");
        const data = await res.json();
        solanaChain = (data.chains as RelayChain[] | undefined)?.find((c) => c.id === SOLANA_CHAIN_ID);
      } catch {
        // fall through — createClient still works for the EVM chains below
      }
      createClient({
        source: "dylmusic.vercel.app",
        chains: [
          convertViemChainToRelayChain(robinhoodChain),
          convertViemChainToRelayChain(base),
          convertViemChainToRelayChain(mainnet),
          ...(solanaChain ? [solanaChain] : []),
        ],
      });
    })();
  }
  return clientReadyPromise;
}

/**
 * Quote for a single Relay-routed leg. `chargeFee` should be true ONLY when
 * this leg is the entire swap, or the terminal leg of a multi-leg NFT
 * purchase — never on both legs of a 2-leg route, which would double-charge
 * one swap 1.7% total instead of 0.85% (same reasoning HOODPrinter's own
 * relay-to-print/print-to-relay legs already follow).
 */
export async function getSwapQuote(params: {
  chainId: number;
  toChainId: number;
  fromCurrency: string;
  toCurrency: string;
  amountWei: string;
  userAddress: string;
  recipientAddress?: string;
  chargeFee: boolean;
}): Promise<Execute> {
  await ensureRelayClient();
  return getQuote({
    chainId: params.chainId,
    currency: params.fromCurrency,
    toChainId: params.toChainId,
    toCurrency: params.toCurrency,
    tradeType: "EXACT_INPUT",
    amount: params.amountWei,
    user: params.userAddress,
    recipient: params.recipientAddress ?? params.userAddress,
    options: params.chargeFee
      ? { appFees: [{ recipient: DYL_FEE_RECIPIENT.toLowerCase(), fee: APP_FEE_BPS }] }
      : undefined,
  });
}

export type SwapLegProgress = { label: string; part: number; total: number };

/**
 * Executes a previously-fetched quote, surfacing Relay's own internal steps
 * via onProgress. `part`/`total` are read directly off the quote's own
 * `steps` array (present before execute() ever runs) so the caller can
 * render a real "Confirmation X/Y" indicator instead of flat text.
 */
export async function executeSwap(quote: Execute, wallet: AdaptedWallet, onProgress?: (p: SwapLegProgress) => void) {
  await ensureRelayClient();
  const totalSteps = quote.steps?.length ?? 1;
  return execute({
    quote,
    wallet,
    onProgress: (data) => {
      const label = data?.currentStep?.description || data?.currentStep?.action;
      if (!label) return;
      const idx = data.steps && data.currentStep ? data.steps.findIndex((s) => s.id === data.currentStep!.id) : -1;
      onProgress?.({ label, part: idx >= 0 ? idx + 1 : 1, total: data.steps?.length ?? totalSteps });
    },
  });
}

/** Number of discrete wallet confirmations a fetched quote will need (approve + swap, etc.) — read before execute() runs. */
export function quoteStepCount(quote: Execute): number {
  return quote.steps?.length ?? 1;
}

// Same URL pattern Relay's own SwapWidget links to on its success screen —
// the requestId is already present on the quote's own steps as soon as
// getQuote() returns, before execute() ever runs.
export function relayTransactionUrl(quote: Execute): string | null {
  const requestId = quote.steps?.find((s) => s.requestId)?.requestId;
  return requestId ? `https://relay.link/transaction/${requestId}` : null;
}

/** Pulls the last on-chain tx hash Relay actually sent for this quote, if the chain matches. */
export function quoteLastTxHash(quote: Execute, chainId: number): string | null {
  const steps = (quote as unknown as { steps?: Array<{ items?: Array<{ txHashes?: Array<{ txHash: string; chainId: number }> }> }> })?.steps;
  for (let i = (steps?.length ?? 0) - 1; i >= 0; i--) {
    const items = steps![i].items ?? [];
    for (let j = items.length - 1; j >= 0; j--) {
      const hashes = items[j].txHashes ?? [];
      for (let k = hashes.length - 1; k >= 0; k--) {
        if (hashes[k].chainId === chainId) return hashes[k].txHash;
      }
    }
  }
  return null;
}

export function adaptDylEvmWallet(walletClient: WalletClient): AdaptedWallet {
  return adaptViemWallet(walletClient);
}

// Phantom's own signAndSendTransaction matches the shape adaptSolanaWallet
// expects exactly — one prompt, sign + broadcast together.
export function adaptDylSolanaWallet(
  address: string,
  signAndSendTransaction: (
    transaction: VersionedTransaction,
    options?: SendOptions,
    instructions?: TransactionInstruction[]
  ) => Promise<{ signature: string }>
): AdaptedWallet {
  // "confirmed" (not the default "finalized") — shaves real time off the
  // round-trip; Solana blockhashes are only valid ~60-90s.
  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  return adaptSolanaWallet(address, SOLANA_CHAIN_ID, connection, signAndSendTransaction);
}

export function quoteOutputAmount(quote: Execute): string | null {
  const details = (quote as unknown as { details?: { currencyOut?: { amount?: string } } })?.details;
  return details?.currencyOut?.amount ?? null;
}

// ---------- Per-chain native EVM balance reads ----------
// A plain async poll loop (not a React hook) needs its own way to read a
// balance on whichever EVM chain a leg landed on — wagmi's useBalance is
// hook-only. Small per-chain public-RPC map, same pattern lib/dylTokens.ts
// already uses for resolveCustomToken.
const EVM_RPC_URLS: Record<number, string> = {
  [robinhoodChain.id]: "https://rpc.mainnet.chain.robinhood.com",
  [base.id]: "https://mainnet.base.org",
  [mainnet.id]: "https://eth.llamarpc.com",
};
const EVM_CHAINS = { [robinhoodChain.id]: robinhoodChain, [base.id]: base, [mainnet.id]: mainnet } as const;

async function getEvmNativeBalanceWei(chainId: number, address: string): Promise<bigint> {
  const chain = EVM_CHAINS[chainId as keyof typeof EVM_CHAINS];
  const rpcUrl = EVM_RPC_URLS[chainId];
  if (!chain || !rpcUrl) throw new Error(`No RPC configured for chain ${chainId}`);
  const client = createPublicClient({ chain, transport: http(rpcUrl) });
  return client.getBalance({ address: address as `0x${string}` });
}

const BALANCE_POLL_INTERVAL_MS = 3000;
const BALANCE_POLL_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Polls a chain's native balance until it rises above `preBalance` or
 * `timeoutMs` elapses — the "wait for the bridge, checking every 3
 * seconds" mechanism HOODPrinter's own swap uses for its relay-to-print
 * leg 1→2 handoff. `onTick` fires roughly once a second (decoupled from the
 * actual 3s poll cadence — a fast bridge that's already settled by the
 * first poll still gets at least one visible "0s" tick) so the caller can
 * show a live counter instead of a static "please wait." Works for either
 * an EVM chain (native ETH) or Solana (native SOL) — pass `isSolana`.
 */
export async function waitForBalanceIncrease(
  chainId: number,
  address: string,
  preBalanceWei: bigint,
  opts: { isSolana?: boolean; intervalMs?: number; timeoutMs?: number; onTick?: (elapsedMs: number) => void } = {}
): Promise<bigint> {
  const interval = opts.intervalMs ?? BALANCE_POLL_INTERVAL_MS;
  const timeout = opts.timeoutMs ?? BALANCE_POLL_TIMEOUT_MS;
  const start = Date.now();
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  if (opts.onTick) {
    opts.onTick(0);
    tickTimer = setInterval(() => opts.onTick?.(Date.now() - start), 1000);
    // Guarantees at least "0s" then "1s" are genuinely visible before the
    // first real balance check, even for a bridge fast enough to have
    // already settled — same fix HOODPrinter's own counter needed after
    // real live Base/mainnet bridges settled too fast to ever show
    // anything but a flash.
    await new Promise((r) => setTimeout(r, 1000));
  }
  try {
    for (;;) {
      const balance = opts.isSolana
        ? BigInt(Math.round(((await getSolanaBalance(address, NATIVE_SOL, 9)) ?? 0) * 1e9))
        : await getEvmNativeBalanceWei(chainId, address);
      if (balance > preBalanceWei) return balance - preBalanceWei;
      const elapsed = Date.now() - start;
      if (elapsed >= timeout) return BigInt(0);
      await new Promise((r) => setTimeout(r, interval));
    }
  } finally {
    if (tickTimer) clearInterval(tickTimer);
  }
}

/** Snapshot of a chain's native balance, for the "preBalance" a later waitForBalanceIncrease call compares against. */
export async function getNativeBalanceWei(chainId: number, address: string, isSolana = false): Promise<bigint> {
  if (isSolana) return BigInt(Math.round(((await getSolanaBalance(address, NATIVE_SOL, 9)) ?? 0) * 1e9));
  return getEvmNativeBalanceWei(chainId, address);
}

// Drives a live "label (Ns)" counter starting the INSTANT it's created —
// covers wallet-signing + Relay's own on-chain confirm, not just the
// post-leg balance-wait phase. `startedAt` is exposed so a caller can hand
// the SAME reference to waitForBalanceIncrease's onTick, keeping one
// continuous count across both phases instead of restarting at 0.
export function startElapsedLabel(render: (elapsedMs: number) => void): { stop: () => void; startedAt: number } {
  const startedAt = Date.now();
  render(0);
  const timer = setInterval(() => render(Date.now() - startedAt), 1000);
  return { stop: () => clearInterval(timer), startedAt };
}
