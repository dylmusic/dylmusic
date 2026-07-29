import { renderOgImage, OG_SIZE } from "@/lib/ogImageTemplate";

export const runtime = "nodejs";
export const alt = "Community Board — Dyl";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  return renderOgImage({
    eyebrow: "COMMUNITY BOARD",
    lines: ["Post a message", "See what other Music NFT", "holders are saying"],
    tag: "MUSIC NFTS · ONCHAIN",
  });
}
