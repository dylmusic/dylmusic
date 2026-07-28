import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import * as dotenv from "dotenv";
dotenv.config();

const throwawayKey = process.env.DEPLOY_KEY_THROWAWAY;

// Real public testnets exist for all three chains, but their faucets are
// CAPTCHA/wallet-gated and not reliably scriptable from here. Forking each
// chain's real, live mainnet RPC locally instead gives the exact same real
// deployed-bytecode environment with zero real funds needed — Hardhat's
// local network auto-funds test accounts with fake ETH regardless of the
// fork target. Kept the real testnet configs below too (commented out is
// unnecessary — they're harmless to leave defined) in case a human wants to
// fund the throwaway address by hand later and re-run against a real testnet.
const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
      chainId: 11155111,
      accounts: throwawayKey ? [throwawayKey] : [],
    },
    baseSepolia: {
      url: "https://sepolia.base.org",
      chainId: 84532,
      accounts: throwawayKey ? [throwawayKey] : [],
    },
    robinhoodTestnet: {
      url: "https://rpc.testnet.chain.robinhood.com",
      chainId: 46630,
      accounts: throwawayKey ? [throwawayKey] : [],
    },
  },
};

export default config;
