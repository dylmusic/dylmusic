"use client";

import { useEffect, useState } from "react";
import { ALLOCATION_CHAINS, AllocationChain } from "@/lib/burnCredits";

// The "split your credits across chains" planner — originally lived inside
// the EVM checker only, using just that checker's own spendable total.
// Moved to page level (Dylan: "we need a total free mints at the bottom...
// below that we need to have the selector for 3 different chains, rather
// than having that under EVM checker") so it plans against the COMBINED
// total across all three checkers (EVM + Solana + Tezos), not just EVM's.
const CHAIN_LABEL: Record<AllocationChain, string> = {
  robinhood: "Robinhood",
  base: "Base",
  solana: "Solana",
  ethereum: "Ethereum",
};

export default function MintAllocator({ spendable }: { spendable: number }) {
  const [allocation, setAllocation] = useState<Record<AllocationChain, number> | null>(null);

  // The total can keep changing as more wallets get checked — a plan built
  // against a stale total would silently under/over-allocate, so any
  // change to the total resets planning back to the "Plan how to spend it"
  // button rather than leaving a now-wrong split on screen.
  useEffect(() => {
    setAllocation(null);
  }, [spendable]);

  function initAllocation() {
    const base = Math.floor(spendable / ALLOCATION_CHAINS.length);
    let remainder = spendable - base * ALLOCATION_CHAINS.length;
    const next = {} as Record<AllocationChain, number>;
    for (const c of ALLOCATION_CHAINS) {
      next[c] = base + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
    }
    setAllocation(next);
  }

  const allocatedTotal = allocation ? ALLOCATION_CHAINS.reduce((s, c) => s + allocation[c], 0) : 0;
  const remaining = spendable - allocatedTotal;

  function adjust(chain: AllocationChain, delta: number) {
    if (!allocation) return;
    const nextVal = allocation[chain] + delta;
    if (nextVal < 0) return;
    if (delta > 0 && remaining <= 0) return;
    setAllocation({ ...allocation, [chain]: nextVal });
  }

  if (spendable <= 0) return null;

  return (
    <div className="credits-panel">
      {!allocation ? (
        <button className="btn-burn-hero credits-plan-btn" onClick={initAllocation}>
          Plan how to spend it
        </button>
      ) : (
        <div className="credits-allocator">
          <div className="credits-allocator-head">
            <span>Split your {spendable.toLocaleString()} credits across chains</span>
            <span className={`credits-remaining${remaining !== 0 ? " warn" : ""}`}>
              {remaining === 0 ? "All allocated" : `${remaining} left to place`}
            </span>
          </div>
          {ALLOCATION_CHAINS.map((c) => (
            <div className="credits-alloc-row" key={c}>
              <span className="credits-alloc-chain">{CHAIN_LABEL[c]}</span>
              <div className="credits-alloc-stepper">
                <button onClick={() => adjust(c, -1)} disabled={allocation[c] <= 0} aria-label={`Fewer on ${CHAIN_LABEL[c]}`}>
                  −
                </button>
                <span className="credits-alloc-num">{allocation[c]}</span>
                <button onClick={() => adjust(c, 1)} disabled={remaining <= 0} aria-label={`More on ${CHAIN_LABEL[c]}`}>
                  +
                </button>
              </div>
            </div>
          ))}
          <div className="credits-alloc-note">
            Not submitted anywhere yet — this just plans it out. Real burning + minting isn&apos;t live.
          </div>
        </div>
      )}
    </div>
  );
}
