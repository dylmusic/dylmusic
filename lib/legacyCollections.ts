// Old, pre-dylmusic Dyl assets eligible for "burn old NFTs, get free mints"
// (see CLAUDE.md "Legacy contracts" for full sourcing/verification notes on
// each of these). Burning itself isn't wired up yet — there's nothing real
// to mint in return until the new per-chain collections exist — this is
// just the real, sourced list the actual burn-eligibility check will run
// against once that's built.

export type LegacyChain = "ethereum" | "polygon" | "base" | "solana" | "tezos";

export interface LegacyAsset {
  chain: LegacyChain;
  chainLabel: string;
  kind: "nft" | "token";
  name: string;
  address: string;
  note?: string;
}

export const LEGACY_ASSETS: LegacyAsset[] = [
  {
    chain: "ethereum",
    chainLabel: "Ethereum",
    kind: "nft",
    name: "Old Dyl NFT collection",
    address: "0x253bfce1757bb2e5f9159738f8309c73dafe09ea",
  },
  {
    chain: "solana",
    chainLabel: "Solana",
    kind: "nft",
    name: "Crypto Rich Deluxe Trading Cards",
    address: "7JvmupdkaFekk2bqqesk4Y22ejQhmpC8Gx5AkB3usgPw",
    note: "Candy Machine ID",
  },
  {
    chain: "tezos",
    chainLabel: "Tezos",
    kind: "nft",
    name: "Dyl (objkt.com)",
    address: "KT1EcBQkN7vuVxg3gDZBbVb7qnBD6kDdS14K",
    note: "FA2 contract",
  },
  {
    chain: "ethereum",
    chainLabel: "Ethereum",
    kind: "token",
    name: "$DYL",
    address: "0x7a8946EDA77817126ffE301249f6DC4C7Df293C3",
  },
  {
    chain: "polygon",
    chainLabel: "Polygon",
    kind: "token",
    name: "$DYL",
    address: "0x4A506181f07Da5ddFDA4ca4c2Fa4c67001dB94B4",
  },
  {
    chain: "base",
    chainLabel: "Base",
    kind: "token",
    name: "$DYL",
    address: "0x4A506181f07Da5ddFDA4ca4c2Fa4c67001dB94B4",
  },
  {
    chain: "solana",
    chainLabel: "Solana",
    kind: "token",
    name: "$DYL",
    address: "DTUW2CFo71KnTNSFYX95jQ8P8aJVQVr8MEF1AGMm5WGm",
  },
];
