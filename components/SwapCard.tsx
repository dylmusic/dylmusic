"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useAccount, useBalance, useSwitchChain, useWalletClient, ConnectorChainMismatchError } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import type { Execute } from "@reservoir0x/relay-sdk";
import {
  CURATED_TOKENS,
  PINNED_TOKENS,
  SWAP_CHAINS,
  NATIVE_ETH,
  SOLANA_CHAIN_ID,
  isSolanaChain,
  findTokenBySymbol,
  chainIdFromParam,
  looksLikeEvmAddress,
  looksLikeSolanaAddress,
  resolveCustomToken,
  type DylToken,
} from "@/lib/dylTokens";
import {
  getSwapQuoteFeeFallback,
  executeSwap,
  quoteOutputAmount,
  quoteStepCount,
  quoteLastTxHash,
  relayTransactionUrl,
  relayRequestId,
  waitForRelaySuccess,
  startElapsedLabel,
  adaptDylEvmWallet,
  adaptDylSolanaWallet,
  type SwapLegProgress,
} from "@/lib/dylSwap";
import { getTokenUsdPrice } from "@/lib/tokenUsdPrice";
import { useSolanaWallet, getSolanaBalance } from "@/lib/solana";
import { wagmiConfig } from "@/lib/web3";
import TokenPickerModal, { TokenIcon } from "./TokenPickerModal";

// Brought up to parity with HOODPrinter's own /swap upgrade (2026-07-28):
// real 0.85% fee, a step-progress overlay for quotes Relay silently splits
// into more than one wallet prompt (an ERC20 origin needing an approve
// step before its swap step), and robust EVM chain-switching. dylmusic was
// the original reference implementation for HOODPrinter's Solana wallet
// integration — this brings the later robustness fixes back the other way.
// Brought up to parity AGAIN (2026-08-11) with HOODPrinter's later 2026-07-29
// updates: a same-chain fee-fallback retry (getSwapQuoteFeeFallback — some
// pairs' best route fails simulation with our appFees attached; retrying
// fee-free beats blocking a real trade), false-failure recovery when
// execute() throws but Relay's backend actually completed the swap
// (checkRelayRequestStatus/waitForRelaySuccess, asks Relay's own request-
// status API instead of trusting a client-side rejection), an
// always-on ticking "(Ns)" overlay (never shows Relay's own raw internal
// step text), Solana blockhash-timeout-specific error copy, and shareable
// pre-filled links (?from=/?to=/&fromChain=/&toChain=, symbol or raw
// address) with the address bar staying in sync as the picker changes.
// Round 3, same day (Dylan: "make sure it works EXACTLY the same as the
// current version of PRINT Swap"): per-side USD pricing + a >25% mismatch
// warning that swaps the CTA to a red "Swap Anyway," balance display
// parity (no "Balance:" label, fmtBalance truncation, a static balance on
// the receive side too), and a persisted per-wallet Transactions feed with
// chain-hover tags and a Relay tx link — the actual visible UI/UX PRINT
// Swap has around the swap box itself, not just its internal robustness.
// Unlike HOODPrinter's /swap, this page has no second "our own pool" leg of
// its own (every swap here is a single Relay-routed leg, even cross-chain —
// Relay's own execute() already waits out the full bridge internally), so
// there's no analog to HOODPrinter's waitForBalanceIncrease/Resume-swap
// machinery to port here; that mechanism belongs to the NFT buy flow
// instead (lib/useTrackCommerce.ts), which genuinely has two real legs.
// Also not ported: the per-currency explorer-link chip on each tx row —
// HOODPrinter's version links a single known chain's explorer; a
// cross-chain-by-default page like this one has no one right explorer to
// pick, so the Relay link (which covers both legs of a bridge) stands in
// for it alone.

const DEFAULT_FROM: DylToken = PINNED_TOKENS.robinhood[0]; // ETH on Robinhood
const DEFAULT_TO: DylToken = PINNED_TOKENS.robinhood[2]; // USDG on Robinhood

const DUST_THRESHOLD = 0.000001;
const fmt = (n: number, max = 6) =>
  n === 0 || (n > 0 && n < DUST_THRESHOLD) ? "0" : n.toLocaleString(undefined, { maximumFractionDigits: max });

// A wallet holding e.g. 39,059.161337 CASHCAT doesn't need all 6 digits on
// screen; full precision is kept below 1, where the extra decimals are the
// only thing separating a real amount from dust. Parity with HOODPrinter's
// own fmtBalance.
const fmtBalance = (n: number) => (n === 0 ? "0" : n >= 1 ? fmt(n, 3) : fmt(n, 6));

const fmtUsd = (n: number) => {
  if (n > 0 && n < DUST_THRESHOLD) return "$0";
  return n > 0 && n < 0.01
    ? `$${n.toFixed(4)}`
    : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// @reservoir0x/relay-svm-wallet-adapter's own confirm step throws exactly
// this the instant a Solana blockhash's ~60-90s validity window closes —
// whether or not the signed tx actually landed (it often does land right
// after this fires; the recovery logic in doSwap below checks Relay's own
// request status instead of trusting this error as definitive).
function isSolanaBlockheightTimeout(e: unknown): boolean {
  const err = e as { message?: string; shortMessage?: string } | undefined;
  const msg = err?.message ?? err?.shortMessage ?? String(e);
  return typeof msg === "string" && (msg.includes("TransactionExpiredBlockheightExceededError") || msg.includes("block height exceeded"));
}

function describeError(e: unknown): string {
  const err = e as { shortMessage?: string; reason?: string; message?: string } | undefined;
  const msg = err?.shortMessage || err?.reason || err?.message;
  if (msg && typeof msg === "string") {
    if (isSolanaBlockheightTimeout(e)) {
      return "Solana network took too long to confirm this transaction (it may have been sent, but expired before landing). Please try again.";
    }
    return msg;
  }
  return "Swap failed.";
}

type SwapTxRow = {
  hash: string;
  fromAmt: string;
  fromSym: string;
  toAmt: string | null;
  toSym: string;
  t: string;
  relayUrl?: string | null;
  fromChainId?: number;
  toChainId?: number;
};

const TXS_STORAGE_KEY = "dyl_swap_txs";
const MAX_TRACKED_WALLETS = 20;

// address (lowercased) -> that wallet's own recent-swap rows — parity with
// HOODPrinter's own per-wallet keying (a single shared slot would mean
// switching wallets on one device clobbers whichever wallet wasn't
// currently connected). Capped to the 20 most-recently-touched wallets.
function loadTxsByWallet(): Record<string, SwapTxRow[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(TXS_STORAGE_KEY) || "null");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}
function saveTxsByWallet(all: Record<string, SwapTxRow[]>) {
  const entries = Object.entries(all);
  const trimmed = entries.length > MAX_TRACKED_WALLETS ? entries.slice(entries.length - MAX_TRACKED_WALLETS) : entries;
  try {
    localStorage.setItem(TXS_STORAGE_KEY, JSON.stringify(Object.fromEntries(trimmed)));
  } catch {
    /* storage blocked / full */
  }
}

// Hover a currency in Transactions to see which chain it was actually on —
// cross-chain swaps mean the same symbol (ETH, USDC) can appear on 3+
// different chains in the same list. Parity with HOODPrinter's own
// ChainTag; no silent guess when chainId is missing (rows saved before
// this shipped) — shows the plain symbol with no popup rather than a
// specific, possibly-wrong chain.
function ChainTag({ chainId, children }: { chainId?: number; children: ReactNode }) {
  const chain = SWAP_CHAINS.find((c) => c.id === chainId);
  if (!chain) return <>{children}</>;
  return (
    <span className="swap-chain-tag">
      {children}
      <span className="swap-chain-tip">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={chain.icon} alt="" className="swap-chain-tip-icon" />
        {chain.name}
      </span>
    </span>
  );
}

type PickerSide = "from" | "to" | null;

export default function SwapCard() {
  const { address: evmAddress, chainId: walletChainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { openConnectModal } = useConnectModal();
  const { switchChainAsync } = useSwitchChain();
  const sol = useSolanaWallet();

  const [fromToken, setFromToken] = useState<DylToken>(DEFAULT_FROM);
  const [toToken, setToToken] = useState<DylToken>(DEFAULT_TO);
  const [amount, setAmount] = useState("");
  const [pickerOpen, setPickerOpen] = useState<PickerSide>(null);

  const [quote, setQuote] = useState<Execute | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const [executing, setExecuting] = useState(false);
  const [legProgress, setLegProgress] = useState<SwapLegProgress | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [relayUrl, setRelayUrl] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [solBalance, setSolBalance] = useState<number | null>(null);

  const [txs, setTxs] = useState<SwapTxRow[]>([]);
  const txsRestoredForRef = useRef<string | null>(null);

  // Per-unit USD price for each side — fetched once per token selection
  // (not per keystroke), powering both the "≈ $X" display and the >25%
  // mismatch warning below.
  const [fromUsdPrice, setFromUsdPrice] = useState<number | null>(null);
  const [toUsdPrice, setToUsdPrice] = useState<number | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fromIsSolana = isSolanaChain(fromToken.chainId);
  const toIsSolana = isSolanaChain(toToken.chainId);

  const userAddress = fromIsSolana ? sol.address : evmAddress ?? null;
  const recipientAddress = toIsSolana ? sol.address : evmAddress ?? null;

  const fromBalance = useBalance({
    address: evmAddress,
    chainId: fromToken.chainId,
    token: fromToken.address === NATIVE_ETH ? undefined : (fromToken.address as `0x${string}`),
    query: { enabled: !!evmAddress && !fromIsSolana },
  });

  const toBalanceEvm = useBalance({
    address: evmAddress,
    chainId: toToken.chainId,
    token: toToken.address === NATIVE_ETH ? undefined : (toToken.address as `0x${string}`),
    query: { enabled: !!evmAddress && !toIsSolana },
  });

  // Solana balance was missing from the "You pay" panel entirely — wagmi's
  // useBalance can't query a non-EVM chain, and nothing replaced it before
  // this. Refetches on token/address change and once more right after a
  // Solana-involving swap confirms. Mirrored for the "You receive" side
  // (toSolBalance) so a Solana destination shows a live balance too, same
  // static-balance parity HOODPrinter's own /swap has on both sides.
  const [solBalanceNonce, setSolBalanceNonce] = useState(0);
  useEffect(() => {
    if (!fromIsSolana || !sol.address) {
      setSolBalance(null);
      return;
    }
    let cancelled = false;
    getSolanaBalance(sol.address, fromToken.address, fromToken.decimals).then((b) => {
      if (!cancelled) setSolBalance(b);
    });
    return () => {
      cancelled = true;
    };
  }, [fromIsSolana, sol.address, fromToken.address, fromToken.decimals, solBalanceNonce]);

  const [toSolBalance, setToSolBalance] = useState<number | null>(null);
  useEffect(() => {
    if (!toIsSolana || !sol.address) {
      setToSolBalance(null);
      return;
    }
    let cancelled = false;
    getSolanaBalance(sol.address, toToken.address, toToken.decimals).then((b) => {
      if (!cancelled) setToSolBalance(b);
    });
    return () => {
      cancelled = true;
    };
  }, [toIsSolana, sol.address, toToken.address, toToken.decimals, solBalanceNonce]);

  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    const amt = parseFloat(amount);
    if (!amt || amt <= 0 || !userAddress || !recipientAddress) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setQuoteLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const amountWei = BigInt(Math.round(amt * 10 ** fromToken.decimals)).toString();
        const { quote: q, feeApplied } = await getSwapQuoteFeeFallback({
          chainId: fromToken.chainId,
          toChainId: toToken.chainId,
          fromCurrency: fromToken.address,
          toCurrency: toToken.address,
          amountWei,
          userAddress,
          recipientAddress,
        });
        if (!feeApplied) console.warn("swap quote: fee-included quote failed simulation, retried fee-free", { fromToken: fromToken.symbol, toToken: toToken.symbol });
        setQuote(q);
      } catch (e) {
        setQuoteError(describeError(e));
      } finally {
        setQuoteLoading(false);
      }
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [amount, fromToken, toToken, userAddress, recipientAddress]);

  // Per-token USD price — refetches on token selection only, not per
  // keystroke (the "≈ $X" line under each side then just multiplies the
  // cached per-unit price by the live typed/estimated amount).
  useEffect(() => {
    let cancelled = false;
    setFromUsdPrice(null);
    setToUsdPrice(null);
    getTokenUsdPrice(fromToken).then((p) => !cancelled && setFromUsdPrice(p));
    getTokenUsdPrice(toToken).then((p) => !cancelled && setToUsdPrice(p));
    return () => {
      cancelled = true;
    };
  }, [fromToken.chainId, fromToken.address, toToken.chainId, toToken.address]);

  // Shareable pre-filled swap links — parity with HOODPrinter's own /swap
  // (?to=usdg, ?from=sol&to=usdc&toChain=solana, or a raw contract/mint
  // address for anything not in the curated list). Symbols stay restricted
  // to the curated list (never resolved from untrusted input); addresses
  // are an opt-in escape hatch, same trust boundary the picker's own
  // paste-a-CA box already has. If only `to` is given and resolves to a
  // Solana token, `from` defaults to native SOL instead of ETH. Guarded by
  // urlInitDoneRef so the write-back effect below can't fire (and clobber
  // a real link) before this one has finished resolving what the page
  // actually loaded with.
  const urlInitDoneRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const fromRaw = params.get("from");
    const toRaw = params.get("to");
    if (!fromRaw && !toRaw) {
      urlInitDoneRef.current = true;
      return;
    }
    const toChainId = params.get("toChain") ? chainIdFromParam(params.get("toChain")!) : undefined;
    const fromChainId = params.get("fromChain") ? chainIdFromParam(params.get("fromChain")!) : undefined;

    async function resolveParam(raw: string | null, explicitChainId: number | undefined): Promise<DylToken | undefined> {
      if (!raw) return undefined;
      if (looksLikeEvmAddress(raw)) {
        return (await resolveCustomToken(explicitChainId ?? PINNED_TOKENS.robinhood[0].chainId, raw)) ?? undefined;
      }
      if (looksLikeSolanaAddress(raw)) {
        return (await resolveCustomToken(explicitChainId ?? SOLANA_CHAIN_ID, raw)) ?? undefined;
      }
      return findTokenBySymbol(raw, explicitChainId);
    }

    (async () => {
      const resolvedTo = await resolveParam(toRaw, toChainId);
      if (resolvedTo) setToToken(resolvedTo);

      const resolvedFrom = fromRaw
        ? await resolveParam(fromRaw, fromChainId)
        : resolvedTo && isSolanaChain(resolvedTo.chainId)
          ? findTokenBySymbol("SOL", SOLANA_CHAIN_ID)
          : undefined;
      if (resolvedFrom) setFromToken(resolvedFrom);
      urlInitDoneRef.current = true;
    })();
  }, []);

  // Keeps the address bar in sync with whatever's currently selected —
  // same fix HOODPrinter needed after shipping the read-only version:
  // nothing wrote ?from=/?to= back out as the picker changed selection, so
  // copying the URL mid-session never reflected the real pair.
  // `history.replaceState` (no reload, no extra history entries) prefers
  // the plain symbol for anything curated, falls back to the raw address
  // for a custom-pasted token, and only adds &fromChain=/&toChain= when a
  // side isn't on Robinhood Chain (the default a bare symbol/address
  // already resolves to).
  useEffect(() => {
    if (typeof window === "undefined" || !urlInitDoneRef.current) return;
    const curatedFrom = findTokenBySymbol(fromToken.symbol, fromToken.chainId);
    const curatedTo = findTokenBySymbol(toToken.symbol, toToken.chainId);
    const fromIsCurated = curatedFrom?.address.toLowerCase() === fromToken.address.toLowerCase();
    const toIsCurated = curatedTo?.address.toLowerCase() === toToken.address.toLowerCase();

    const robinhoodChainId = PINNED_TOKENS.robinhood[0].chainId;
    const params = new URLSearchParams();
    params.set("from", fromIsCurated ? fromToken.symbol : fromToken.address);
    params.set("to", toIsCurated ? toToken.symbol : toToken.address);
    if (fromToken.chainId !== robinhoodChainId) {
      const c = SWAP_CHAINS.find((c) => c.id === fromToken.chainId);
      if (c) params.set("fromChain", c.name.toLowerCase());
    }
    if (toToken.chainId !== robinhoodChainId) {
      const c = SWAP_CHAINS.find((c) => c.id === toToken.chainId);
      if (c) params.set("toChain", c.name.toLowerCase());
    }

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    if (newUrl !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, "", newUrl);
    }
  }, [fromToken.chainId, fromToken.address, fromToken.symbol, toToken.chainId, toToken.address, toToken.symbol]);

  // Restores this wallet's recent-swap feed, keyed per-address (switching
  // between an EVM and a Solana selection genuinely means a different
  // signer, so a different feed is correct, not a bug). Always resets txs
  // on an address change — leaving stale rows on screen from a previously
  // connected wallet would be worse than a real empty state.
  useEffect(() => {
    if (!userAddress || txsRestoredForRef.current === userAddress) return;
    txsRestoredForRef.current = userAddress;
    const saved = loadTxsByWallet()[userAddress.toLowerCase()];
    setTxs(Array.isArray(saved) ? saved.slice(0, 25) : []);
  }, [userAddress]);

  useEffect(() => {
    if (!userAddress || !txs.length) return;
    const all = loadTxsByWallet();
    all[userAddress.toLowerCase()] = txs.slice(0, 25);
    saveTxsByWallet(all);
  }, [userAddress, txs]);

  function addTx(row: SwapTxRow) {
    setTxs((prev) => [row, ...prev].slice(0, 25));
  }

  function selectToken(side: PickerSide, t: DylToken) {
    if (side === "from") {
      if (t.chainId === toToken.chainId && t.address.toLowerCase() === toToken.address.toLowerCase()) {
        setToToken(fromToken);
      }
      setFromToken(t);
    } else if (side === "to") {
      if (t.chainId === fromToken.chainId && t.address.toLowerCase() === fromToken.address.toLowerCase()) {
        setFromToken(toToken);
      }
      setToToken(t);
    }
    setDone(false);
  }

  function flipSides() {
    setFromToken(toToken);
    setToToken(fromToken);
    setAmount("");
    setDone(false);
  }

  function connectFromWallet() {
    if (fromIsSolana) sol.connect();
    else openConnectModal?.();
  }

  // Switches the EVM wallet to `chainId` and returns a FRESH wallet client
  // scoped to it. Two real bugs found live while porting this from
  // HOODPrinter's own swap made both steps necessary:
  // 1) switchChainAsync's own promise can resolve before the injected
  //    wallet's real eth_chainId has caught up — retrying getWalletClient
  //    on ConnectorChainMismatchError absorbs that race.
  // 2) the walletClient object from useWalletClient() is a plain snapshot
  //    captured once per render — it does NOT reflect a switch made earlier
  //    in the SAME function call, so every send after a switch must use a
  //    freshly-fetched client, never the outer hook value.
  async function ensureEvmChain(chainId: number) {
    await switchChainAsync({ chainId });
    for (let attempt = 0; ; attempt++) {
      try {
        return await getWalletClient(wagmiConfig, { chainId });
      } catch (e) {
        if (attempt >= 5 || !(e instanceof ConnectorChainMismatchError)) throw e;
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  }

  async function doSwap() {
    if (!userAddress) {
      connectFromWallet();
      return;
    }
    if (!recipientAddress) {
      if (toIsSolana) sol.connect();
      return;
    }
    if (!quote) return;
    setTxError(null);
    setTxHash(null);
    setRelayUrl(null);
    setExecuting(true);
    // Always shows the branded "Waiting for Confirmation" overlay with a
    // live "(Ns)" ticking counter, even for a plain 1/1 swap — parity with
    // HOODPrinter's own fix after a real live SOL -> CASHCAT swap leaked
    // Relay's own raw internal step text ("Depositing funds to the
    // relayer...") straight to the screen. Relay's own progress label is
    // never shown; onProgress below only updates the real step count
    // (progPart/progTotal), so an ERC20 origin needing an approve step
    // before its swap step still renders correctly as 1/2 -> 2/2.
    let legLabel = "Confirm in wallet…";
    let progPart = 1;
    let progTotal = quoteStepCount(quote);
    const ticker = startElapsedLabel((ms) => setLegProgress({ part: progPart, total: progTotal, label: `${legLabel} (${Math.round(ms / 1000)}s)` }));
    const requestId = relayRequestId(quote);
    try {
      let wallet;
      if (fromIsSolana) {
        const provider = sol.getProvider();
        if (!provider) throw new Error("Phantom wallet not found.");
        wallet = adaptDylSolanaWallet(sol.address!, (tx, opts) => provider.signAndSendTransaction(tx, opts));
      } else {
        const client = await ensureEvmChain(fromToken.chainId);
        wallet = adaptDylEvmWallet(client);
      }
      let hash: string | null = null;
      let relayLinkUrl: string | null = relayTransactionUrl(quote);
      let outFormatted: string | null = null;
      try {
        const { data: result } = await executeSwap(quote, wallet, (p) => {
          progPart = p.part;
          progTotal = p.total;
        });
        hash = quoteLastTxHash(result, fromToken.chainId);
        relayLinkUrl = relayTransactionUrl(result) ?? relayLinkUrl;
        outFormatted =
          (result as unknown as { details?: { currencyOut?: { amountFormatted?: string } } })?.details?.currencyOut?.amountFormatted ?? null;
      } catch (execErr) {
        // A real live SOL -> CASHCAT swap on HOODPrinter's own /swap threw
        // here (execute() itself rejected) even though Relay's backend had
        // already completed the swap — a signed tx, or Relay's own
        // confirmation of it, can land AFTER our client-side wait gives up.
        // Asks Relay's own request-status API directly (ground truth,
        // independent of whether our local execute() call succeeded) using
        // the requestId already known from the quote. Only treated as
        // recovered on an explicit "success" status — anything else
        // re-throws the original error.
        legLabel = "Checking for bridge…";
        const recovered = requestId ? await waitForRelaySuccess(requestId) : null;
        if (recovered?.status !== "success") throw execErr;
        hash = recovered.originTxHash ?? recovered.destinationTxHash;
        outFormatted = recovered.outputAmountFormatted;
      }
      setTxHash(hash);
      setRelayUrl(relayLinkUrl);
      setDone(true);
      addTx({
        hash: hash ?? `relay-${requestId ?? Date.now()}`,
        fromAmt: amount,
        fromSym: fromToken.symbol,
        toAmt: outFormatted ? `~${fmt(Number(outFormatted))}` : null,
        toSym: toToken.symbol,
        t: new Date().toLocaleTimeString(),
        relayUrl: relayLinkUrl,
        fromChainId: fromToken.chainId,
        toChainId: toToken.chainId,
      });
      setAmount("");
      setQuote(null);
      fromBalance.refetch();
      toBalanceEvm.refetch();
      if (fromIsSolana || toIsSolana) setSolBalanceNonce((n) => n + 1);
    } catch (e) {
      setTxError(describeError(e));
    } finally {
      ticker.stop();
      setExecuting(false);
      setLegProgress(null);
    }
  }

  const outAmount = quote ? quoteOutputAmount(quote) : null;
  const previewOut = outAmount ? Number(outAmount) / 10 ** toToken.decimals : null;
  const outDisplay = previewOut !== null ? fmt(previewOut) : "";
  const maxAmount = fromIsSolana ? solBalance ?? 0 : fromBalance.data ? Number(fromBalance.data.formatted) : 0;
  const toBalanceDisplay = toIsSolana ? toSolBalance : toBalanceEvm.data ? Number(toBalanceEvm.data.formatted) : null;

  const amt = parseFloat(amount) || 0;
  const fromUsdTotal = fromUsdPrice !== null && amt > 0 ? fromUsdPrice * amt : null;
  const toUsdTotal = toUsdPrice !== null && previewOut !== null ? toUsdPrice * previewOut : null;
  const mismatchPct =
    fromUsdTotal !== null && toUsdTotal !== null && fromUsdTotal > 0
      ? (Math.abs(fromUsdTotal - toUsdTotal) / fromUsdTotal) * 100
      : null;
  const showMismatchWarning = mismatchPct !== null && mismatchPct > 25;

  const ctaLabel = !userAddress
    ? fromIsSolana
      ? "Connect Phantom"
      : "Connect Wallet"
    : !recipientAddress
    ? "Connect Phantom to Receive"
    : executing
    ? "Confirm in wallet…"
    : quoteLoading
    ? "Fetching rate…"
    : showMismatchWarning
    ? "Swap Anyway"
    : "Swap";

  return (
    <>
      <div className="swap-card">
        <div className="swap-panel">
          <div className="swap-panel-head">
            <span>You Pay</span>
            {userAddress && (fromIsSolana ? solBalance !== null : !!evmAddress) && (
              <button className="swap-balance" onClick={() => setAmount(String(Math.max(0, maxAmount)))}>
                {fmtBalance(maxAmount)} {fromToken.symbol}
              </button>
            )}
          </div>
          <div className="swap-panel-row">
            <input
              className="swap-amount-input"
              type="number"
              inputMode="decimal"
              placeholder="0.0"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setDone(false);
              }}
            />
            <button className="swap-token-pill-wrap" onClick={() => setPickerOpen("from")}>
              <span className="swap-token-pill">
                <span className="swap-token-pill-icon">
                  <TokenIcon token={fromToken} size={18} />
                </span>
                {fromToken.symbol}
                <span className="swap-token-caret">▾</span>
              </span>
            </button>
          </div>
          {fromUsdTotal !== null && <p className="swap-usd-note">≈ {fmtUsd(fromUsdTotal)}</p>}
        </div>

        <div className="swap-flip-row">
          <button className="swap-flip-btn" onClick={flipSides} aria-label="Flip sides">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M4 2v9M4 11 1.5 8.5M4 11l2.5-2.5M10 12V3M10 3l2.5 2.5M10 3 7.5 5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <div className="swap-panel">
          <div className="swap-panel-head">
            <span>You Receive</span>
            {toBalanceDisplay !== null && (
              <span className="swap-balance swap-balance-static">
                {fmtBalance(toBalanceDisplay)} {toToken.symbol}
              </span>
            )}
          </div>
          <div className="swap-panel-row">
            <div className="swap-amount-display">{quoteLoading ? "…" : outDisplay || "0.0"}</div>
            <button className="swap-token-pill-wrap" onClick={() => setPickerOpen("to")}>
              <span className="swap-token-pill">
                <span className="swap-token-pill-icon">
                  <TokenIcon token={toToken} size={18} />
                </span>
                {toToken.symbol}
                <span className="swap-token-caret">▾</span>
              </span>
            </button>
          </div>
          {toUsdTotal !== null && <p className="swap-usd-note">≈ {fmtUsd(toUsdTotal)}</p>}
        </div>

        {fromToken.chainId !== toToken.chainId && (
          <div className="swap-route-note">Cross-chain — needs both wallets connected.</div>
        )}
        {quoteError && <div className="swap-route-note swap-route-error">{quoteError}</div>}
        {txError && <div className="swap-route-note swap-route-error">{txError}</div>}
        {done && <div className="swap-route-note swap-route-success">Swap complete.</div>}

        {showMismatchWarning && fromUsdTotal !== null && toUsdTotal !== null && (
          <div className="swap-mismatch-warn">
            ⚠️ <strong>Price mismatch:</strong> you&rsquo;re paying ≈{fmtUsd(fromUsdTotal)} but receiving ≈
            {fmtUsd(toUsdTotal)} — a {fmt(mismatchPct!, 0)}% difference. This is much bigger than normal fees or
            slippage and usually means a bad quote, an illiquid token, or a mistake. Double check before continuing.
          </div>
        )}

        {!userAddress ? (
          <button type="button" className="swap-cta" onClick={connectFromWallet}>
            {fromIsSolana ? "Connect Phantom" : "Connect Wallet"}
          </button>
        ) : !recipientAddress ? (
          <button type="button" className="swap-cta" onClick={() => sol.connect()}>
            Connect Phantom to Receive
          </button>
        ) : (
          <>
            {executing && legProgress && (
              <div className="swap-waiting">
                <span className="buy-confirm-ring" />
                <p className="buy-confirm-waiting-title">
                  Waiting for Confirmation {legProgress.part}/{legProgress.total}
                </p>
                <p className="buy-confirm-waiting-sub">{legProgress.label}</p>
                <div className="buy-confirm-dots">
                  {Array.from({ length: legProgress.total }, (_, i) => i + 1).map((n) => (
                    <Fragment key={n}>
                      {n > 1 && <span className={`buy-confirm-step-line${legProgress!.part >= n ? " active" : ""}`} />}
                      <span className={`buy-confirm-dot${legProgress!.part >= n ? " done" : ""}`} />
                    </Fragment>
                  ))}
                </div>
              </div>
            )}
            <button
              className={`swap-cta${showMismatchWarning ? " swap-cta-danger" : ""}`}
              disabled={executing || (!!userAddress && !!recipientAddress && (!quote || quoteLoading))}
              onClick={doSwap}
            >
              {ctaLabel}
            </button>
          </>
        )}

        {txHash && (
          <div className="swap-route-note swap-route-success">
            ✅ Swap sent
            {relayUrl && (
              <>
                {" — "}
                <a href={relayUrl} target="_blank" rel="noopener noreferrer">
                  view on Relay ↗
                </a>
              </>
            )}
          </div>
        )}

        <TokenPickerModal
          open={pickerOpen !== null}
          chainId={pickerOpen === "to" ? toToken.chainId : fromToken.chainId}
          tokens={CURATED_TOKENS}
          pinnedTokens={PINNED_TOKENS.robinhood.concat(PINNED_TOKENS.base, PINNED_TOKENS.solana, PINNED_TOKENS.ethereum)}
          onClose={() => setPickerOpen(null)}
          onSelect={(t) => selectToken(pickerOpen, t)}
        />
      </div>

      <section className="swap-tx-card">
        <h2>Transactions</h2>
        <div className="swap-txs">
          {txs.length === 0 && <div className="swap-tx-empty">No swaps yet — your recent swaps will land here.</div>}
          {txs.map((tx) => (
            <div key={tx.hash} className="swap-tx ok">
              <div className="swap-tx-main">
                <span className="swap-tx-status" />
                <span className="swap-tx-amt">
                  {tx.fromAmt} <ChainTag chainId={tx.fromChainId}>{tx.fromSym}</ChainTag>
                </span>
                <span className="swap-tx-hash">
                  {tx.toAmt ? (
                    <>
                      → {tx.toAmt} <ChainTag chainId={tx.toChainId}>{tx.toSym}</ChainTag>
                    </>
                  ) : (
                    <span className="swap-tx-hash-truncate">
                      {tx.hash.slice(0, 10)}…{tx.hash.slice(-6)}
                    </span>
                  )}
                </span>
              </div>
              <div className="swap-tx-meta">
                <span className="swap-tx-t">{tx.t}</span>
                {tx.relayUrl && (
                  <a className="swap-tx-link swap-tx-relay" href={tx.relayUrl} target="_blank" rel="noopener noreferrer">
                    Relay ↗
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
