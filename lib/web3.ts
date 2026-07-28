import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { base, mainnet } from "wagmi/chains";
import type { Chain } from "wagmi/chains";

// Reused from the HOODPrinter /swap project's real Reown project — same
// account, works immediately. Worth splitting into its own dedicated Reown
// project later so wallets show this site's own name/domain instead.
export const WALLETCONNECT_PROJECT_ID = "fd51ab18ab89f8b0a1d9cb90623c5563";

export const robinhoodChain: Chain = {
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.mainnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: "https://robinhoodchain.blockscout.com",
    },
  },
};

export const wagmiConfig = getDefaultConfig({
  appName: "dylmusic",
  projectId: WALLETCONNECT_PROJECT_ID,
  // mainnet added for the admin panel's Ethereum collection deploy/upgrade —
  // Robinhood Chain and Base already covered browsing/swap, Ethereum was
  // EVM-target #3 with nothing needing a mainnet signature until now.
  chains: [base, robinhoodChain, mainnet],
  ssr: true,
});
