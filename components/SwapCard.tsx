"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useAccount, useBalance, useSwitchChain, useWalletClient, ConnectorChainMismatchError } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import type { Execute } from "@reservoir0x/relay-sdk";
import { CURATED_TOKENS, PINNED_TOKENS, NATIVE_ETH, isSolanaChain, type DylToken } from "@/lib/dylTokens";
import {
  getSwapQuote,
  executeSwap,
  quoteOutputAmount,
  quoteStepCount,
  quoteLastTxHash,
  relayTransactionUrl,
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

function describeError(e: unknown): string {
  const err = e as { shortMessage?: string; reason?: string; message?: string } | undefined;
  const msg = err?.shortMessage || err?.reason || err?.message;
  if (msg && typeof msg === "string") return msg;
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
        const q = await getSwapQuote({
          chainId: fromToken.chainId,
          toChainId: toToken.chainId,
          fromCurrency: fromToken.address,
          toCurrency: toToken.address,
          amountWei,
          userAddress,
          recipientAddress,
          chargeFee: true,
        });
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
    const relaySteps = quoteStepCount(quote);
    if (relaySteps > 1) setLegProgress({ part: 1, total: relaySteps, label: "Confirm in wallet…" });
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
      const { data: result } = await executeSwap(quote, wallet, (p) =>
        relaySteps > 1 ? setLegProgress({ part: p.part, total: p.total, label: p.label }) : undefined
      );
      const hash = quoteLastTxHash(result, fromToken.chainId);
      setTxHash(hash);
      setRelayUrl(relayTransactionUrl(result));
      setDone(true);
      setAmount("");
      setQuote(null);
      fromBalance.refetch();
      if (fromIsSolana || toIsSolana) setSolBalanceNonce((n) => n + 1);
    } catch (e) {
      setTxError(describeError(e));
    } finally {
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
