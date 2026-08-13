"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { useSolanaWallet } from "@/lib/solana";
import { emptyTiers, SolanaCheckResult, SolanaTieredItem } from "@/lib/solanaCollectionCheck";
import { CARD_TIER_MINTS, dylMintsForBalance } from "@/lib/burnCredits";
import { burnSolanaNft, burnSolanaDyl } from "@/lib/burnActions";
import { DYL_SOL_MINT } from "@/lib/solanaCollectionCheck";

export default function SolanaWalletChecker({
  onSpendableChange,
}: {
  onSpendableChange?: (n: number) => void;
}) {
  const { address, connect, hasPhantom } = useSolanaWallet();
  // Claiming only ever happens on an EVM chain (see lib/burnClaimSigner.ts)
  // — a Solana burn is verified against the Solana wallet below, but the
  // EARNED CREDIT has to land in the ledger of the EVM wallet that will
  // eventually submit the claim. Same wagmi connection BurnWalletChecker
  // already establishes elsewhere on this page.
  const { address: evmAddress } = useAccount();
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<SolanaCheckResult | null>(null);
  const [burningKey, setBurningKey] = useState<string | null>(null);
  const [burnedKeys, setBurnedKeys] = useState<Set<string>>(new Set());
  const [burnError, setBurnError] = useState<string | null>(null);
  const [realLedgerSpendable, setRealLedgerSpendable] = useState(0);

  async function refreshRealLedger() {
    if (!evmAddress) return;
    try {
      const res = await fetch(`/api/burn/verify?wallet=${encodeURIComponent(evmAddress)}`, { cache: "no-store" });
      const data = await res.json();
      setRealLedgerSpendable(data?.ledger?.spendable ?? 0);
    } catch {
      // leave whatever was already shown
    }
  }

  useEffect(() => {
    if (evmAddress) refreshRealLedger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evmAddress]);

  async function burnCard(item: SolanaTieredItem) {
    if (!address || !evmAddress) return;
    const key = `card:${item.mint}`;
    setBurningKey(key);
    setBurnError(null);
    try {
      await burnSolanaNft(address, item.mint);
      const res = await fetch("/api/burn/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: evmAddress, originWallet: address, kind: "solana-card", mintAddress: item.mint }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Verification failed after burn.");
      setBurnedKeys((prev) => new Set(prev).add(key));
      if (data.ledger) setRealLedgerSpendable(data.ledger.spendable);
    } catch (e) {
      setBurnError(e instanceof Error ? e.message : "Burn failed.");
    } finally {
      setBurningKey(null);
    }
  }

  async function burnDyl() {
    if (!address || !evmAddress) return;
    const key = "dyl";
    setBurningKey(key);
    setBurnError(null);
    try {
      await burnSolanaDyl(address, DYL_SOL_MINT);
      const res = await fetch("/api/burn/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: evmAddress, originWallet: address, kind: "solana-dyl" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Verification failed after burn.");
      setBurnedKeys((prev) => new Set(prev).add(key));
      if (data.ledger) setRealLedgerSpendable(data.ledger.spendable);
    } catch (e) {
      setBurnError(e instanceof Error ? e.message : "Burn failed.");
    } finally {
      setBurningKey(null);
    }
  }

  async function checkWallet() {
    if (!address) return;
    setChecking(true);
    // Goes through our own server route (app/api/solana-check), not a
    // direct browser call to the public Solana RPC — that endpoint 403s a
    // lot of residential/mobile IPs under its own abuse-prevention, so
    // every check now runs from one consistent server IP instead.
    try {
      const res = await fetch(`/api/solana-check?address=${encodeURIComponent(address)}`);
      const r: SolanaCheckResult = await res.json();
      setResult(r);
    } catch {
      setResult({ dylBalance: 0, tiers: emptyTiers(), items: [], error: "Check failed" });
    }
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
    onSpendableChange?.(realLedgerSpendable);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realLedgerSpendable]);

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
          {result && (
            <button
              className="checker-toggle"
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? "Collapse results" : "Expand results"}
            >
              {open ? "▲" : "▼"}
            </button>
          )}
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

          {(result.items.length > 0 || result.dylBalance > 0) && (
            <div className="credits-panel">
              <div className="credits-head">
                <span className="credits-head-title">Burn for real credit</span>
                <span className="credits-head-note">
                  {!evmAddress
                    ? "Connect an EVM wallet above (Buy/Claim happens on Robinhood Chain) — that's the wallet your credits go to."
                    : realLedgerSpendable > 0
                      ? `${realLedgerSpendable.toLocaleString()} real credit${realLedgerSpendable === 1 ? "" : "s"} confirmed so far.`
                      : "A real protocol-level SPL burn, verified server-side before crediting."}
                </span>
              </div>
              <div className="credits-rows">
                {result.items.map((item) => {
                  const key = `card:${item.mint}`;
                  const done = burnedKeys.has(key);
                  const amount = CARD_TIER_MINTS[item.tier] ?? 0;
                  return (
                    <div className="credits-row" key={key}>
                      <span className="credits-row-label">
                        {item.mint.slice(0, 4)}…{item.mint.slice(-4)} ({item.tier}) — {amount} mints
                      </span>
                      <button
                        className="btn-burn-hero burn-checker-btn"
                        disabled={!!burningKey || done || !evmAddress}
                        onClick={() => burnCard(item)}
                      >
                        {done ? "Burned ✓" : burningKey === key ? "Burning…" : "Burn"}
                      </button>
                    </div>
                  );
                })}
                {result.dylBalance > 0 && (
                  <div className="credits-row">
                    <span className="credits-row-label">
                      {result.dylBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })} $DYL (Solana)
                    </span>
                    <button
                      className="btn-burn-hero burn-checker-btn"
                      disabled={!!burningKey || burnedKeys.has("dyl") || !evmAddress}
                      onClick={burnDyl}
                    >
                      {burnedKeys.has("dyl") ? "Burned ✓" : burningKey === "dyl" ? "Burning…" : "Burn All"}
                    </button>
                  </div>
                )}
                {burnError && (
                  <div className="credits-row muted">
                    <span className="credits-row-label">Burn failed: {burnError}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
