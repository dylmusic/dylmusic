"use client";

import { Fragment, useEffect, useRef, useState } from "react";
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
// Unlike HOODPrinter's /swap, this page has no second "our own pool" leg of
// its own (every swap here is a single Relay-routed leg, even cross-chain —
// Relay's own execute() already waits out the full bridge internally), so
// there's no analog to HOODPrinter's waitForBalanceIncrease/Resume-swap
// machinery to port here; that mechanism belongs to the NFT buy flow
// instead (lib/useTrackCommerce.ts), which genuinely has two real legs.

const DEFAULT_FROM: DylToken = PINNED_TOKENS.robinhood[0]; // ETH on Robinhood
const DEFAULT_TO: DylToken = PINNED_TOKENS.robinhood[2]; // USDG on Robinhood

const DUST_THRESHOLD = 0.000001;
const fmt = (n: number, max = 6) =>
  n === 0 || (n > 0 && n < DUST_THRESHOLD) ? "0" : n.toLocaleString(undefined, { maximumFractionDigits: max });

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

  // Solana balance was missing from the "You pay" panel entirely — wagmi's
  // useBalance can't query a non-EVM chain, and nothing replaced it before
  // this. Refetches on token/address change and once more right after a
  // Solana-involving swap confirms.
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
      let relayUrl: string | null = relayTransactionUrl(quote);
      try {
        const { data: result } = await executeSwap(quote, wallet, (p) => {
          progPart = p.part;
          progTotal = p.total;
        });
        hash = quoteLastTxHash(result, fromToken.chainId);
        relayUrl = relayTransactionUrl(result) ?? relayUrl;
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
      }
      setTxHash(hash);
      setRelayUrl(relayUrl);
      setDone(true);
      setAmount("");
      setQuote(null);
      fromBalance.refetch();
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
  const outDisplay = outAmount ? fmt(Number(outAmount) / 10 ** toToken.decimals) : "";
  const maxAmount = fromIsSolana ? solBalance ?? 0 : fromBalance.data ? Number(fromBalance.data.formatted) : 0;

  const ctaLabel = !userAddress
    ? fromIsSolana
      ? "Connect Phantom"
      : "Connect Wallet"
    : !recipientAddress
    ? "Connect Phantom to Receive"
    : executing
    ? legProgress
      ? "Confirm in wallet…"
      : "Swapping…"
    : quoteLoading
    ? "Fetching rate…"
    : "Swap";

  return (
    <div className="swap-card">
      <div className="swap-panel">
        <div className="swap-panel-head">
          <span>You Pay</span>
          {userAddress && (fromIsSolana ? solBalance !== null : !fromIsSolana && evmAddress) && (
            <button className="swap-balance" onClick={() => setAmount(String(Math.max(0, maxAmount)))}>
              Balance: {fmt(maxAmount, 4)}
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
      </div>

      {fromToken.chainId !== toToken.chainId && (
        <div className="swap-route-note">Cross-chain — needs both wallets connected.</div>
      )}
      {quoteError && <div className="swap-route-note swap-route-error">{quoteError}</div>}
      {txError && <div className="swap-route-note swap-route-error">{txError}</div>}
      {done && <div className="swap-route-note swap-route-success">Swap complete.</div>}

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
          <button className="swap-cta" disabled={executing || (!!userAddress && !!recipientAddress && (!quote || quoteLoading))} onClick={doSwap}>
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
  );
}
