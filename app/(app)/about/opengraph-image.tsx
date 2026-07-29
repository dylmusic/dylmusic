import { renderOgImage, OG_SIZE } from "@/lib/ogImageTemplate";

export const runtime = "nodejs";
export const alt = "About Dyl";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  return renderOgImage({
    eyebrow: "ABOUT",
    lines: ["The OG crypto rapper", "on why he built his own", "Music NFT platform"],
    tag: "MUSIC NFTS · ONCHAIN",
  });
}
