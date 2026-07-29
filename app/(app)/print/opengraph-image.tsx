import { renderOgImage, OG_SIZE } from "@/lib/ogImageTemplate";

export const runtime = "nodejs";
export const alt = "$PRINT — Dyl";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  return renderOgImage({
    eyebrow: "A LITTLE EASTER EGG",
    lines: ["$PRINT pays 5% rewards", "in real ETH on Robinhood Chain"],
    tag: "MUSIC NFTS · ONCHAIN",
  });
}
