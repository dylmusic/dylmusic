"use client";

import { CHAINS, ChainKey } from "@/lib/albums";

export default function ChainSwitcher({
  selected,
  onSelect,
}: {
  selected: ChainKey;
  onSelect: (chain: ChainKey) => void;
}) {
  return (
    <div className="chain-switch nav-chain-switch" role="tablist" aria-label="Select chain">
      {CHAINS.filter((c) => c.live).map((c) => (
        <button
          key={c.key}
          role="tab"
          aria-selected={selected === c.key}
          className={`chain-pill${selected === c.key ? " active" : ""}`}
          style={
            selected === c.key
              ? ({ "--chain-color": c.color } as React.CSSProperties)
              : undefined
          }
          onClick={() => onSelect(c.key)}
        >
          <span className="chain-dot" style={{ background: c.color }} />
          {c.shortLabel}
        </button>
      ))}
    </div>
  );
}
