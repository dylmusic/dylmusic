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
import type { WalletClient } from "viem";
import { robinhoodChain } from "./web3";
import { base } from "wagmi/chains";
import { SOLANA_CHAIN_ID } from "./dylTokens";

// Headless Relay SDK usage — same package HOODPrinter's own /swap uses
// directly instead of the pre-built widget. No dylmusic-specific pool to
// protect here, so every swap is just a single plain Relay-routed leg — no
// fee-skimming, no forced-route special-casing. Unlike HOODPrinter (EVM
// only, Solana explicitly scoped-but-not-built), dylmusic actually sells
// NFT editions priced in SOL on the Solana chain, so real Solana routing
// is in scope here from the start, not a later phase.

const SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";

let clientReadyPromise: Promise<void> | null = null;

// `createClient({chains})` accepts the exact shape Relay's own /chains API
// returns (RelayChain is literally typed off that response) — fetching
// Solana's real entry live avoids hand-authoring chain metadata that could
// be wrong. Robinhood Chain needs explicit registration because it's not
// in the SDK's baked-in defaults (same "Unable to find chain" bug
// HOODPrinter's own /swap hit and fixed); Base and Solana likely already
// are, but registering all three explicitly removes the guesswork.
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
          ...(solanaChain ? [solanaChain] : []),
        ],
      });
    })();
  }
  return clientReadyPromise;
}

export async function getSwapQuote(params: {
  chainId: number;
  toChainId: number;
  fromCurrency: string;
  toCurrency: string;
  amountWei: string;
  userAddress: string;
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
    recipient: params.userAddress,
  });
}

export async function executeSwap(
  quote: Execute,
  wallet: AdaptedWallet,
  onProgress?: (label: string) => void
) {
  await ensureRelayClient();
  return execute({
    quote,
    wallet,
    onProgress: (data) => {
      const desc = data?.currentStep?.description || data?.currentStep?.action;
      if (desc) onProgress?.(desc);
    },
  });
}

export function adaptDylEvmWallet(walletClient: WalletClient): AdaptedWallet {
  return adaptViemWallet(walletClient);
}

// Phantom's own signAndSendTransaction (see lib/solana.ts) matches the shape
// adaptSolanaWallet expects exactly — one prompt, sign + broadcast together.
export function adaptDylSolanaWallet(
  address: string,
  signAndSendTransaction: (
    transaction: VersionedTransaction,
    options?: SendOptions,
    instructions?: TransactionInstruction[]
  ) => Promise<{ signature: string }>
): AdaptedWallet {
  const connection = new Connection(SOLANA_RPC_URL);
  return adaptSolanaWallet(address, SOLANA_CHAIN_ID, connection, signAndSendTransaction);
}

export function quoteOutputAmount(quote: Execute): string | null {
  const details = (quote as unknown as { details?: { currencyOut?: { amount?: string } } })?.details;
  return details?.currencyOut?.amount ?? null;
}
