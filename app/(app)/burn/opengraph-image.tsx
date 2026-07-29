import { renderOgImage, OG_SIZE } from "@/lib/ogImageTemplate";

export const runtime = "nodejs";
export const alt = "Burn Old NFTs & $Dyl Coin";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  return renderOgImage({
    eyebrow: "BURN & EARN",
    lines: ["Burn old Dyl NFTs & $Dyl coin", "across Ethereum, Solana, and Tezos", "Earn free mints"],
    tag: "MUSIC NFTS · ONCHAIN",
  });
}
