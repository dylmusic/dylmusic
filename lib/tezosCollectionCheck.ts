// Real Tezos FA2 balance check via TzKT's public API — same reliable,
// no-key-needed indexer already used to verify the burn address and the
// collection itself (see CLAUDE.md). The address itself now comes from a
// real Beacon wallet connection (see lib/tezosBeacon.ts /
// components/TezosWalletChecker.tsx), not a pasted string.

const OBJKT_CONTRACT = "KT1EcBQkN7vuVxg3gDZBbVb7qnBD6kDdS14K";

export interface TezosCheckResult {
  count: number;
  error?: string;
}

export async function checkTezosWallet(address: string): Promise<TezosCheckResult> {
  try {
    const url = `https://api.tzkt.io/v1/tokens/balances?account=${encodeURIComponent(
      address
    )}&token.contract=${OBJKT_CONTRACT}&balance.gt=0&select=balance&limit=1000`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`TzKT ${res.status}`);
    const rows: string[] = await res.json();
    const count = rows.reduce((sum, b) => sum + Number(b || 0), 0);
    return { count };
  } catch (e) {
    return { count: 0, error: e instanceof Error ? e.message : "Check failed" };
  }
}
