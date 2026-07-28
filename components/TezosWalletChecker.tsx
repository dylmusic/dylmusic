"use client";

import { useState } from "react";
import { checkTezosWallet, isLikelyTezosAddress, TezosCheckResult } from "@/lib/tezosCollectionCheck";

// No Temple/Trust Wallet SDK is wired up yet (neither exposes a simple
// injected-provider connect the way Phantom does for Solana — Temple's own
// is a heavier Beacon-SDK integration, Trust Wallet has none for Tezos at
// all outside its mobile app) — rather than fake a "Connect" button that
// doesn't really do a wallet handshake, this takes a pasted address
// (exactly what both wallets' own "Copy Address" feature gives you) and
// checks it for real against TzKT. Honest about the mechanism, still
// fully functional today.
export default function TezosWalletChecker() {
  const [addressInput, setAddressInput] = useState("");
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<TezosCheckResult | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const validAddress = isLikelyTezosAddress(addressInput);

  async function checkWallet() {
    if (!validAddress) return;
    setChecking(true);
    setHint(null);
    const r = await checkTezosWallet(addressInput.trim());
    setResult(r);
    setChecking(false);
    setOpen(true);
  }

  const count = result?.count ?? 0;
  const spendable = count; // Tezos: 1 NFT = 1 mint, flat, per CLAUDE.md

  return (
    <div className="burn-checker">
      <div className="burn-checker-head">
        <div>
          <div className="burn-checker-title">
            Tezos Wallet Checker
            {result && <span className="checker-checked-badge">✓ Checked</span>}
          </div>
          <div className="burn-checker-sub">Check your Dyl collection on objkt.com</div>
        </div>
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

      <div className="tezos-input-row">
        <button
          type="button"
          className="tezos-wallet-hint-btn"
          onClick={() => setHint("Open Temple Wallet → tap your account → Copy Address, then paste it here.")}
        >
          Temple Wallet
        </button>
        <button
          type="button"
          className="tezos-wallet-hint-btn"
          onClick={() => setHint("Open Trust Wallet → Tezos → Receive → Copy Address, then paste it here.")}
        >
          Trust Wallet
        </button>
      </div>

      <div className="tezos-input-row">
        <input
          className="tezos-address-input"
          value={addressInput}
          placeholder="Paste your tz1… address"
          onChange={(e) => {
            setAddressInput(e.target.value);
            setHint(null);
          }}
        />
        <button className="btn-burn-hero burn-checker-btn" onClick={checkWallet} disabled={!validAddress || checking}>
          {checking ? (
            <>
              <span className="btn-spinner" />
              Checking…
            </>
          ) : result ? (
            "Re-check"
          ) : (
            "Check"
          )}
        </button>
      </div>
      {hint && <div className="tezos-hint">{hint}</div>}
      {addressInput && !validAddress && (
        <div className="tezos-hint warn">That doesn&apos;t look like a real Tezos address yet.</div>
      )}

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
