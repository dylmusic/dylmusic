"use client";

import { useEffect, useState } from "react";
import { useTezosWallet } from "@/lib/tezosBeacon";
import { checkTezosWallet, TezosCheckResult } from "@/lib/tezosCollectionCheck";

function truncateAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function TezosWalletChecker({
  onSpendableChange,
}: {
  onSpendableChange?: (n: number) => void;
}) {
  const { address, connect, disconnect, connecting, error: connectError } = useTezosWallet();
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<TezosCheckResult | null>(null);

  async function checkWallet() {
    if (!address) return;
    setChecking(true);
    const r = await checkTezosWallet(address);
    setResult(r);
    setChecking(false);
  }

  const count = result?.count ?? 0;
  const spendable = count; // Tezos: 1 NFT = 1 mint, flat, per CLAUDE.md

  useEffect(() => {
    onSpendableChange?.(spendable);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spendable]);

  return (
    <div className="burn-checker">
      <div className="burn-checker-head">
        <div>
          <div className="burn-checker-title">
            Tezos Wallet Checker
            {result && <span className="checker-checked-badge">✓ Checked</span>}
          </div>
          <div className="burn-checker-sub">
            Check your Dyl collection on objkt.com, with Temple or Trust Wallet
          </div>
        </div>
        <div className="checker-head-actions">
          {!address ? (
            <button className="btn-burn-hero burn-checker-btn" onClick={connect} disabled={connecting}>
              {connecting ? (
                <>
                  <span className="btn-spinner" />
                  Connecting…
                </>
              ) : (
                "Connect Wallet"
              )}
            </button>
          ) : (
            <button
              className="btn-burn-hero burn-checker-btn"
              onClick={checkWallet}
              disabled={checking}
              title={result ? "Click to re-check" : undefined}
            >
              {checking ? (
                <>
                  <span className="btn-spinner" />
                  Checking…
                </>
              ) : result ? (
                `${spendable.toLocaleString()} Free Mint${spendable === 1 ? "" : "s"} ↻`
              ) : (
                "Check My Wallet"
              )}
            </button>
          )}
          {result && (
            <button
              className="checker-toggle"
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? "Collapse results" : "Expand results"}
            >
              {open ? "▲" : "▼"}
            </button>
          )}
        </div>
      </div>

      {address && (
        <div className="tezos-connected-row">
          Connected: <span className="tezos-connected-addr">{truncateAddr(address)}</span>
          <button className="tezos-disconnect-btn" onClick={disconnect}>
            Disconnect
          </button>
        </div>
      )}
      {connectError && <div className="tezos-hint warn">{connectError}</div>}

      {result && open && (
        <>
          <div className="burn-checker-total burn-checker-total-combined">
            <div className="burn-checker-total-part">
              <span className="burn-checker-total-num">{count}</span>
              <span className="burn-checker-total-label">Dyl NFT{count === 1 ? "" : "s"} found</span>
            </div>
            <div className="burn-checker-total-part burn-checker-total-equals">
              <span className="burn-checker-total-num">= {spendable.toLocaleString()}</span>
              <span className="burn-checker-total-label">free mint{spendable === 1 ? "" : "s"}</span>
            </div>
          </div>

          <div className="credits-panel">
            <div className="credits-head">
              <span className="credits-head-title">What your Tezos bag is worth</span>
              <span className="credits-head-note">1 NFT = 1 mint on Tezos.</span>
            </div>
            <div className="credits-rows">
              {count > 0 ? (
                <div className="credits-row">
                  <span className="credits-row-label">
                    {count} NFT{count === 1 ? "" : "s"} from the Dyl collection
                  </span>
                  <span className="credits-row-value">{count} mints</span>
                </div>
              ) : result.error ? (
                <div className="credits-row muted">
                  <span className="credits-row-label">Check failed: {result.error}</span>
                </div>
              ) : (
                <div className="credits-row muted">
                  <span className="credits-row-label">Nothing found for this address.</span>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
