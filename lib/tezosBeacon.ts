"use client";

import { useCallback, useEffect, useState } from "react";

// Real Tezos wallet connect via Beacon (TZIP-10) — the actual standard both
// Temple Wallet and Trust Wallet support, same role RainbowKit plays for
// EVM here. There's no simple injected `window.temple`-style provider to
// call directly (per Temple's own extension docs, connections go through a
// content-script/Beacon bridge, not a global object) — @airgap/beacon-sdk's
// DAppClient is the vendor-recommended integration, same "use the official
// widget-integration pairing" call already made for RainbowKit/Relay
// elsewhere in this app rather than hand-rolling wallet detection.
//
// One requestPermissions() call opens Beacon's own pairing UI: Temple shows
// up automatically at the top if the extension is installed (it registers
// itself as a Beacon browser-extension peer), and a "Pair with
// WalletConnect" option below it covers Trust Wallet (mobile-only for
// Tezos — Beacon added WalletConnect v2 as a transport specifically so
// WC2-only wallets like Trust could support Tezos dApps without their own
// Beacon integration). Both wallets are reached through this single real
// flow — there's no way to jump straight to "just Temple" or "just Trust"
// without reimplementing Beacon's own pairing/transport logic.
//
// The client is a lazy singleton: constructing a DAppClient touches
// localStorage/IndexedDB, so it must never run at module-eval time (which
// would run during Next's server render of this "use client" component).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let clientPromise: Promise<any> | null = null;

async function getClient() {
  if (typeof window === "undefined") throw new Error("Beacon is client-only");
  if (!clientPromise) {
    clientPromise = import("@airgap/beacon-sdk").then(({ DAppClient }) => {
      return new DAppClient({ name: "Dyl Music NFTs" });
    });
  }
  return clientPromise;
}

export function useTezosWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getClient()
      .then((client) => client.getActiveAccount())
      .then((account: { address: string } | undefined) => {
        if (!cancelled && account) setAddress(account.address);
      })
      .catch(() => {
        /* no prior session — fine */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const client = await getClient();
      const permissions = await client.requestPermissions();
      setAddress(permissions.address);
    } catch (e) {
      // Beacon throws a real error object when the user closes the pairing
      // modal without connecting — not a real failure, don't show a scary
      // message for it.
      const message = e instanceof Error ? e.message : "Connect failed";
      if (!/abort|closed/i.test(message)) setError(message);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    const client = await getClient();
    await client.clearActiveAccount();
    setAddress(null);
  }, []);

  return { address, connect, disconnect, connecting, error };
}
