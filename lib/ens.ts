"use client";

import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

// ENS is a mainnet-only registry — resolving it has nothing to do with
// which chain a track/edition lives on, so this deliberately doesn't reuse
// the app's Base/Robinhood Chain wagmi config, just a plain read-only
// mainnet client.
const ensClient = createPublicClient({ chain: mainnet, transport: http() });

const cache = new Map<string, string | null>();

export async function resolveEnsName(address: string): Promise<string | null> {
  const key = address.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;
  try {
    const name = await ensClient.getEnsName({ address: address as `0x${string}` });
    cache.set(key, name ?? null);
    return name ?? null;
  } catch {
    cache.set(key, null);
    return null;
  }
}
