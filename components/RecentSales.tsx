"use client";

import { useEffect, useState } from "react";
import { CHAINS } from "@/lib/albums";
import { ActivityEntry, readRecentActivity } from "@/lib/activity";
import { getNickname } from "@/lib/nicknames";
import { resolveEnsName } from "@/lib/ens";

function truncate(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function timeAgo(ts: number) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

export default function RecentSales({ refreshKey }: { refreshKey: number }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    setEntries(readRecentActivity(12));
  }, [refreshKey]);

  useEffect(() => {
    let cancelled = false;

    async function resolveNames() {
      const resolved: Record<string, string> = {};
      const unique = Array.from(new Set(entries.map((s) => s.wallet)));

      await Promise.all(
        unique.map(async (wallet) => {
          const nickname = getNickname(wallet);
          if (nickname) {
            resolved[wallet] = nickname;
            return;
          }
          if (wallet.startsWith("0x")) {
            const ens = await resolveEnsName(wallet);
            if (ens) {
              resolved[wallet] = ens;
              return;
            }
          }
          resolved[wallet] = truncate(wallet);
        })
      );

      if (!cancelled) setNames(resolved);
    }

    if (entries.length) resolveNames();
    return () => {
      cancelled = true;
    };
  }, [entries]);

  if (entries.length === 0) {
    return (
      <div className="sales-empty">
        <span className="sales-empty-dot" /> Awaiting first transaction
      </div>
    );
  }

  return (
    <div className="sales-list">
      {entries.map((e) => {
        const chainInfo = CHAINS.find((c) => c.key === e.chain)!;
        return (
          <div key={e.id} className={`sales-row ${e.type}`}>
            <span className="chain-dot" style={{ background: chainInfo.color }} />
            <span className="sales-who">{names[e.wallet] ?? truncate(e.wallet)}</span>
            <span className={`sales-verb ${e.type}`}>{e.type === "buy" ? "bought" : "listed"}</span>
            <span className="sales-track">{e.trackTitle}</span>
            {e.editionNumber != null && <span className="sales-edition">#{e.editionNumber}</span>}
            <span className="sales-price">${e.priceUsd.toFixed(2)}</span>
            <span className="sales-chain">{chainInfo.shortLabel}</span>
            <span className="sales-time">{timeAgo(e.ts)}</span>
          </div>
        );
      })}
    </div>
  );
}
