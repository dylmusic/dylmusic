"use client";

import { useEffect, useState } from "react";
import { getNickname } from "./nicknames";
import { resolveEnsName } from "./ens";
import { isAdminWallet } from "./admin";

export function truncateAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// Resolves a batch of wallet addresses to display names for chat/board:
// Dyl's own admin wallet always shows as "Dyl" (paired with his real PFP by
// the caller, via isAdminWallet), then a self-chosen nickname, then a live
// ENS reverse lookup, falling back to a truncated address. Mirrors the
// nickname > ENS > truncate priority RecentSales.tsx already established.
export function useResolvedNames(wallets: string[]): Record<string, string> {
  const key = Array.from(new Set(wallets)).sort().join(",");
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      const unique = key ? key.split(",") : [];
      if (unique.length === 0) return;
      const resolved: Record<string, string> = {};
      await Promise.all(
        unique.map(async (wallet) => {
          if (isAdminWallet(wallet)) {
            resolved[wallet] = "Dyl";
            return;
          }
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
          resolved[wallet] = truncateAddress(wallet);
        })
      );
      if (!cancelled) setNames((prev) => ({ ...prev, ...resolved }));
    }

    resolve();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return names;
}
