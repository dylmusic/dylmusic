import { renderOgImage, OG_SIZE } from "@/lib/ogImageTemplate";

export const runtime = "nodejs";
export const alt = "Chat — Dyl";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  return renderOgImage({
    eyebrow: "LIVE CHAT",
    lines: ["Chat with Dyl Music NFT holders", "Hold any edition to join"],
    tag: "MUSIC NFTS · ONCHAIN",
  });
}
