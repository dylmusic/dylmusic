import { renderOgImage, OG_SIZE } from "@/lib/ogImageTemplate";

export const runtime = "nodejs";
export const alt = "Swap — Dyl";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  return renderOgImage({
    eyebrow: "DYL SWAP",
    lines: ["Swap any token cross-chain", "for $Dyl or any curated token", "Robinhood · Base · Ethereum · Solana"],
    tag: "MUSIC NFTS · ONCHAIN",
  });
}
