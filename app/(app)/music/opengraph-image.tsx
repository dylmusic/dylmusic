import { renderOgImage, OG_SIZE } from "@/lib/ogImageTemplate";

export const runtime = "nodejs";
export const alt = "Music — Dyl";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  return renderOgImage({
    eyebrow: "DISCOGRAPHY",
    lines: ["Stream every track", "Collect numbered onchain editions", "Robinhood · Base · Ethereum · Solana"],
    tag: "MUSIC NFTS · ONCHAIN",
  });
}
