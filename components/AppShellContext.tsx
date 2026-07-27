"use client";

import { createContext, useContext } from "react";
import { ChainKey } from "@/lib/albums";

interface AppShellState {
  chain: ChainKey;
  walletAddress: string | null;
  requestConnect: () => void;
}

export const AppShellContext = createContext<AppShellState | null>(null);

export function useAppShell(): AppShellState {
  const ctx = useContext(AppShellContext);
  if (!ctx) throw new Error("useAppShell must be used within the (app) layout");
  return ctx;
}
