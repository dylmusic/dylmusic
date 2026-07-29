import { renderOgImage, OG_SIZE } from "@/lib/ogImageTemplate";

export const runtime = "nodejs";
export const alt = "Dashboard — Dyl Music NFTs";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  return renderOgImage({
    eyebrow: "LIVE STATS",
    lines: ["Mint volume · editions minted", "streaming numbers · NFT sales", "updated in real time"],
    tag: "MUSIC NFTS · ONCHAIN",
  });
}
