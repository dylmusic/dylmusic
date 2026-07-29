import { BrowserProvider, type JsonRpcSigner } from "ethers";
import type { WalletClient } from "viem";

// @opensea/seaport-js and @opensea/sdk are ethers-native (they expect a real
// ethers Signer for EIP-712 order signing and the one-time Seaport approval
// tx) — this app is wagmi/viem throughout otherwise. viem's WalletClient
// exposes an EIP-1193-compatible `.transport.request`, which is exactly what
// ethers.BrowserProvider accepts; this is the standard, documented viem <->
// ethers interop pattern, not a custom workaround.
export function viemWalletClientToEthersSigner(walletClient: WalletClient): Promise<JsonRpcSigner> {
  const { account, chain, transport } = walletClient;
  if (!account) throw new Error("Wallet client has no connected account.");
  const network = chain ? { chainId: chain.id, name: chain.name } : undefined;
  const provider = new BrowserProvider(transport, network);
  return provider.getSigner(account.address);
}
