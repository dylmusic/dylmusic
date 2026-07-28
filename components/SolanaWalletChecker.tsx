"use client";

import { useState } from "react";
import { useSolanaWallet } from "@/lib/solana";
import { checkSolanaWallet, SolanaCheckResult } from "@/lib/solanaCollectionCheck";
import { CARD_TIER_MINTS, dylMintsForBalance } from "@/lib/burnCredits";

export default function SolanaWalletChecker() {
  const { address, connect, hasPhantom } = useSolanaWallet();
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<SolanaCheckResult | null>(null);

  async function checkWallet() {
    if (!address) return;
    setChecking(true);
    const r = await checkSolanaWallet(address);
    setResult(r);
    setChecking(false);
    setOpen(true);
  }

  // No on-chain tier lookup available for Solana yet (see
  // lib/solanaCollectionCheck.ts — no Blockscout-style indexer verified for
  // it in this session), so credits show as a min-max range like the ETH
  // checker did before that upgrade: min = every card priced as cheapest
  // tier, max = priced as the richest tier we have a number for. The
  // conservative min is what actually counts toward spendable.
  const cardCount = result?.cardCount ?? 0;
  const min = cardCount * (CARD_TIER_MINTS.standard ?? 0);
  const max = cardCount * (CARD_TIER_MINTS.platinum ?? 0);
  const dylMints = dylMintsForBalance(result?.dylBalance ?? 0);
  const spendable = min + dylMints;

  return (
    <div className="burn-checker">
      <div className="burn-checker-head">
        <div>
          <div className="burn-checker-title">
            Solana Wallet Checker
            {result && <span className="checker-checked-badge">✓ Checked</span>}
          </div>
          <div className="burn-checker-sub">Check your Trading Cards + $Dyl on Solana, with Phantom</div>
        </div>
        <div className="checker-head-actions">
          {!address ? (
            <button className="btn-burn-hero burn-checker-btn" onClick={connect}>
              {hasPhantom ? "Connect Phantom" : "Install Phantom"}
            </button>
          ) : (
            <button className="btn-burn-hero burn-checker-btn" onClick={checkWallet} disabled={checking}>
              {checking ? (
                <>
                  <span className="btn-spinner" />
                  Checking Wallet…
                </>
              ) : result ? (
                "Re-check"
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

      {result && open && (
        <>
          <div className="burn-checker-total burn-checker-total-combined">
            <div className="burn-checker-total-part">
              <span className="burn-checker-total-num">{cardCount}</span>
              <span className="burn-checker-total-label">trading card{cardCount === 1 ? "" : "s"} found</span>
            </div>
            <div className="burn-checker-total-part">
              <span className="burn-checker-total-num">
                {result.dylBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
              <span className="burn-checker-total-label">$DYL coin found</span>
            </div>
            <div className="burn-checker-total-part burn-checker-total-equals">
              <span className="burn-checker-total-num">= {spendable.toLocaleString()}</span>
              <span className="burn-checker-total-label">free mint{spendable === 1 ? "" : "s"}</span>
            </div>
          </div>

          <div className="credits-panel">
            <div className="credits-head">
              <span className="credits-head-title">What your Solana bag is worth</span>
              <span className="credits-head-note">
                Tier detection isn&apos;t verified for Solana yet — shown as a range, conservative side counted.
              </span>
            </div>

            <div className="credits-rows">
              {cardCount > 0 && (
                <div className="credits-row">
                  <span className="credits-row-label">
                    {cardCount} card{cardCount === 1 ? "" : "s"}
                  </span>
                  <span className="credits-row-value">
                    {min === max ? min : `${min}–${max}`} mints
                  </span>
                </div>
              )}
              {result.dylBalance > 0 && (
                <div className="credits-row">
                  <span className="credits-row-label">
                    {result.dylBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })} $DYL held
                  </span>
                  <span className="credits-row-value">{dylMints} mints</span>
                </div>
              )}
              {result.error && (
                <div className="credits-row muted">
                  <span className="credits-row-label">Check failed: {result.error}</span>
                </div>
              )}
              {cardCount === 0 && result.dylBalance === 0 && !result.error && (
                <div className="credits-row muted">
                  <span className="credits-row-label">Nothing eligible found in this wallet.</span>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
