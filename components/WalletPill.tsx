"use client";

import { ChainKey } from "@/lib/albums";

function truncate(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export default function WalletPill({
  chain,
  evmAddress,
  solAddress,
  onConnectEvm,
  onConnectSol,
  onDisconnectEvm,
  onDisconnectSol,
}: {
  chain: ChainKey;
  evmAddress?: string | null;
  solAddress?: string | null;
  onConnectEvm: () => void;
  onConnectSol: () => void;
  onDisconnectEvm: () => void;
  onDisconnectSol: () => void;
}) {
  const isSol = chain === "solana";
  const address = isSol ? solAddress : evmAddress;

  if (address) {
    return (
      <button
        className="wallet-pill connected"
        onClick={isSol ? onDisconnectSol : onDisconnectEvm}
        title="Click to disconnect"
      >
        <span className="wallet-dot" />
        {truncate(address)}
      </button>
    );
  }

  return (
    <button className="wallet-pill" onClick={isSol ? onConnectSol : onConnectEvm}>
      Connect {isSol ? "Phantom" : "Wallet"}
    </button>
  );
}
