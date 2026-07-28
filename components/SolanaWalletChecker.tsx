"use client";

import { useEffect, useMemo, useState } from "react";
import { useSolanaWallet } from "@/lib/solana";
import { checkSolanaWallet, SolanaCheckResult } from "@/lib/solanaCollectionCheck";
import { CARD_TIER_MINTS, dylMintsForBalance } from "@/lib/burnCredits";

export default function SolanaWalletChecker({
  onSpendableChange,
}: {
  onSpendableChange?: (n: number) => void;
}) {
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
  }

  // Exact per-token tier lookup now (verified-creator match against the
  // candy machine ID + the on-chain name string — see
  // lib/solanaCollectionCheck.ts), same precision the ETH checker already
  // has. Diamond and any unrecognized tier show as held but "Not priced
  // yet" rather than guessing, matching how the ETH checker treats its own
  // unpriced items.
  const tiers = result?.tiers;
  const { dylMints, spendable } = useMemo(() => {
    const t = tiers;
    const tCredits = t
      ? t.standard * (CARD_TIER_MINTS.standard ?? 0) +
        t.gold * (CARD_TIER_MINTS.gold ?? 0) +
        t.platinum * (CARD_TIER_MINTS.platinum ?? 0)
      : 0;
    const dMints = dylMintsForBalance(result?.dylBalance ?? 0);
    return { dylMints: dMints, spendable: tCredits + dMints };
  }, [tiers, result]);

  useEffect(() => {
    onSpendableChange?.(spendable);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spendable]);

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
            <button
              className="btn-burn-hero burn-checker-btn"
              onClick={checkWallet}
              disabled={checking}
              title={result ? "Click to re-check" : undefined}
            >
              {checking ? (
                <>
                  <span className="btn-spinner" />
                  Checking Wallet…
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

      {result && open && (
        <>
          <div className="burn-checker-total burn-checker-total-combined">
            <div className="burn-checker-total-part">
              <span className="burn-checker-total-num">{tiers?.total ?? 0}</span>
              <span className="burn-checker-total-label">trading card{(tiers?.total ?? 0) === 1 ? "" : "s"} found</span>
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
                Real per-token tiers, verified on-chain against the candy machine.
              </span>
            </div>

            <div className="credits-rows">
              {tiers && tiers.standard > 0 && (
                <div className="credits-row">
                  <span className="credits-row-label">{tiers.standard} Standard card{tiers.standard === 1 ? "" : "s"}</span>
                  <span className="credits-row-value">{tiers.standard * (CARD_TIER_MINTS.standard ?? 0)} mints</span>
                </div>
              )}
              {tiers && tiers.gold > 0 && (
                <div className="credits-row">
                  <span className="credits-row-label">{tiers.gold} Gold card{tiers.gold === 1 ? "" : "s"}</span>
                  <span className="credits-row-value">{tiers.gold * (CARD_TIER_MINTS.gold ?? 0)} mints</span>
                </div>
              )}
              {tiers && tiers.platinum > 0 && (
                <div className="credits-row">
                  <span className="credits-row-label">{tiers.platinum} Platinum card{tiers.platinum === 1 ? "" : "s"}</span>
                  <span className="credits-row-value">{tiers.platinum * (CARD_TIER_MINTS.platinum ?? 0)} mints</span>
                </div>
              )}
              {tiers && tiers.diamond > 0 && (
                <div className="credits-row muted">
                  <span className="credits-row-label">{tiers.diamond} Diamond card{tiers.diamond === 1 ? "" : "s"}</span>
                  <span className="credits-row-value">Not priced yet</span>
                </div>
              )}
              {tiers && tiers.unknown > 0 && (
                <div className="credits-row muted">
                  <span className="credits-row-label">{tiers.unknown} unrecognized card{tiers.unknown === 1 ? "" : "s"}</span>
                  <span className="credits-row-value">Not priced yet</span>
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
              {(tiers?.total ?? 0) === 0 && result.dylBalance === 0 && !result.error && (
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
