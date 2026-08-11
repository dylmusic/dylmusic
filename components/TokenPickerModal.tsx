"use client";

import { useEffect, useMemo, useState } from "react";
import { SWAP_CHAINS, resolveCustomToken, looksLikeAddress, type DylToken, type SwapChain } from "@/lib/dylTokens";

// Styled after HOODPrinter's own "Select Token" modal — same UX (chain
// pills up top, search + pinned row + results list) rebranded onto
// dylmusic's own dark-card / --accent design language. Generic over
// whatever token pool the caller passes in, so the real Swap page and the
// cosmetic buy-confirmation modal can share one component.

type Props = {
  open: boolean;
  chainId: number;
  tokens: DylToken[];
  pinnedTokens: DylToken[];
  chains?: SwapChain[];
  allowCustomAddress?: boolean;
  onClose: () => void;
  onSelect: (token: DylToken) => void;
};

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function TokenIcon({ token, size = 28 }: { token: DylToken; size?: number }) {
  const style = { width: size, height: size };
  const [broken, setBroken] = useState(false);
  if (token.logo && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="tp-row-icon" style={style} src={token.logo} alt="" onError={() => setBroken(true)} />;
  }
  if (token.isNative) {
    return (
      <span className="tp-row-icon tp-row-icon-eth" style={style}>
        <svg width="100%" height="100%" viewBox="0 0 24 24" aria-hidden="true">
          <polygon points="12,2 20,12 12,16 4,12" fill="var(--accent)" />
          <polygon points="12,2 12,16 4,12" fill="color-mix(in srgb, var(--accent) 55%, black)" />
          <polygon points="12,22 20,13 12,17 4,13" fill="var(--accent)" />
          <polygon points="12,22 12,17 4,13" fill="color-mix(in srgb, var(--accent) 55%, black)" />
        </svg>
      </span>
    );
  }
  return (
    <span className="tp-row-icon tp-row-icon-fallback" style={style}>
      <svg width="62%" height="62%" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3c3 2.5 5 5.5 5 8.5A5 5 0 0 1 7 11.5C7 8.5 9 5.5 12 3z" fill="currentColor" />
        <path d="M12 21v-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export default function TokenPickerModal({
  open,
  chainId,
  tokens,
  pinnedTokens,
  chains = SWAP_CHAINS,
  allowCustomAddress = true,
  onClose,
  onSelect,
}: Props) {
  const [query, setQuery] = useState("");
  const [customToken, setCustomToken] = useState<DylToken | null>(null);
  const [customLoading, setCustomLoading] = useState(false);
  const [browseChainId, setBrowseChainId] = useState(chainId);

  useEffect(() => {
    if (open) setBrowseChainId(chainId);
  }, [open, chainId]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setCustomToken(null);
    }
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    setCustomToken(null);
    if (!allowCustomAddress || !looksLikeAddress(browseChainId, q)) return;
    setCustomLoading(true);
    const timer = setTimeout(() => {
      resolveCustomToken(browseChainId, q)
        .then((t) => setCustomToken(t))
        .finally(() => setCustomLoading(false));
    }, 400);
    return () => clearTimeout(timer);
  }, [query, browseChainId, allowCustomAddress]);

  const pool = useMemo(() => tokens.filter((t) => t.chainId === browseChainId), [tokens, browseChainId]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pool;
    return pool.filter(
      (t) => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.address.toLowerCase() === q
    );
  }, [query, pool]);

  if (!open) return null;

  return (
    <div className="tp-overlay" onClick={onClose}>
      <div className="tp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tp-head">
          <h3>Select Token</h3>
          <button type="button" className="tp-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="tp-body">
          {chains.length > 0 && (
            <div className="tp-chains">
              <span className="tp-chains-label">Select Chain</span>
              <div className="tp-chains-row">
                {chains.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`tp-chain-pill${c.id === browseChainId ? " active" : ""}${c.enabled ? "" : " disabled"}`}
                    disabled={!c.enabled}
                    onClick={() => setBrowseChainId(c.id)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c.icon} alt="" className="tp-chain-pill-icon" />
                    {c.name}
                    {!c.enabled && <span className="tp-chain-pill-soon">Soon</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="tp-token-side">
            <input
              className="tp-search"
              type="text"
              placeholder={allowCustomAddress ? "Search for a token or paste address" : "Search for a token"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />

            <div className="tp-pinned-row">
              {pinnedTokens
                .filter((t) => t.chainId === browseChainId)
                .map((t) => (
                  <button
                    key={t.address}
                    type="button"
                    className="tp-pinned-pill"
                    onClick={() => {
                      onSelect(t);
                      onClose();
                    }}
                  >
                    <TokenIcon token={t} size={20} />
                    {t.symbol}
                  </button>
                ))}
            </div>

            <div className="tp-results">
              {customLoading && <div className="tp-empty">Looking up token…</div>}
              {customToken && !results.some((r) => r.address.toLowerCase() === customToken.address.toLowerCase()) && (
                <button
                  type="button"
                  className="tp-row"
                  onClick={() => {
                    onSelect(customToken);
                    onClose();
                  }}
                >
                  <TokenIcon token={customToken} />
                  <span className="tp-row-text">
                    <strong>{customToken.symbol}</strong>
                    <span>
                      {customToken.name} {shortAddr(customToken.address)}
                    </span>
                  </span>
                </button>
              )}
              {!customLoading && !customToken && results.length === 0 && (
                <div className="tp-empty">No token found.</div>
              )}
              {results.map((t) => (
                <button
                  key={t.address}
                  type="button"
                  className="tp-row"
                  onClick={() => {
                    onSelect(t);
                    onClose();
                  }}
                >
                  <TokenIcon token={t} />
                  <span className="tp-row-text">
                    <strong>{t.symbol}</strong>
                    <span>{t.isNative ? t.name : `${t.name} ${shortAddr(t.address)}`}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
