"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useBalance, useSwitchChain, useWalletClient } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import type { Execute } from "@reservoir0x/relay-sdk";
import { CURATED_TOKENS, PINNED_TOKENS, NATIVE_ETH, isSolanaChain, type DylToken } from "@/lib/dylTokens";
import { getSwapQuote, executeSwap, quoteOutputAmount, adaptDylEvmWallet, adaptDylSolanaWallet } from "@/lib/dylSwap";
import { useSolanaWallet } from "@/lib/solana";
import TokenPickerModal, { TokenIcon } from "./TokenPickerModal";

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
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fromIsSolana = isSolanaChain(fromToken.chainId);
  const toIsSolana = isSolanaChain(toToken.chainId);

  // The "from" side's wallet is always the one that signs (it's the side
  // spending); the "to" side's wallet is just where funds land — for a pure
  // EVM<->EVM swap that's the same address either way, but a Solana leg on
  // either side needs Phantom's own address specifically, distinct from an
  // EVM address, since Relay needs the real recipient address for that
  // chain's VM to route funds there.
  const userAddress = fromIsSolana ? sol.address : evmAddress ?? null;
  const recipientAddress = toIsSolana ? sol.address : evmAddress ?? null;

  const fromBalance = useBalance({
    address: evmAddress,
    chainId: fromToken.chainId,
    token: fromToken.address === NATIVE_ETH ? undefined : (fromToken.address as `0x${string}`),
    query: { enabled: !!evmAddress && !fromIsSolana },
  });

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
    setExecuting(true);
    setProgressLabel("Confirm in wallet…");
    try {
      let wallet;
      if (fromIsSolana) {
        const provider = sol.getProvider();
        if (!provider) throw new Error("Phantom wallet not found.");
        wallet = adaptDylSolanaWallet(sol.address!, (tx, opts, ix) =>
          provider.signAndSendTransaction(tx, opts)
        );
      } else {
        if (!walletClient) throw new Error("Wallet not connected.");
        if (walletChainId !== fromToken.chainId) {
          await switchChainAsync({ chainId: fromToken.chainId });
        }
        wallet = adaptDylEvmWallet(walletClient);
      }
      await executeSwap(quote, wallet, (label) => setProgressLabel(label));
      setDone(true);
      setAmount("");
      setQuote(null);
      fromBalance.refetch();
    } catch (e) {
      setTxError(describeError(e));
    } finally {
      setExecuting(false);
      setProgressLabel(null);
    }
  }

  const outAmount = quote ? quoteOutputAmount(quote) : null;
  const outDisplay = outAmount ? fmt(Number(outAmount) / 10 ** toToken.decimals) : "";
  const maxAmount = fromBalance.data ? Number(fromBalance.data.formatted) : 0;

  const ctaLabel = !userAddress
    ? fromIsSolana
      ? "Connect Phantom"
      : "Connect Wallet"
    : !recipientAddress
    ? "Connect Phantom to Receive"
    : executing
    ? progressLabel || "Swapping…"
    : quoteLoading
    ? "Fetching rate…"
    : "Swap";

  return (
    <div className="swap-card">
      <div className="swap-panel">
        <div className="swap-panel-head">
          <span>You Pay</span>
          {evmAddress && !fromIsSolana && (
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

      <button
        className="swap-cta"
        disabled={executing || (!!userAddress && !!recipientAddress && (!quote || quoteLoading))}
        onClick={doSwap}
      >
        {ctaLabel}
      </button>

      <TokenPickerModal
        open={pickerOpen !== null}
        chainId={pickerOpen === "to" ? toToken.chainId : fromToken.chainId}
        tokens={CURATED_TOKENS}
        pinnedTokens={PINNED_TOKENS.robinhood.concat(PINNED_TOKENS.base, PINNED_TOKENS.solana)}
        onClose={() => setPickerOpen(null)}
        onSelect={(t) => selectToken(pickerOpen, t)}
      />
    </div>
  );
}
