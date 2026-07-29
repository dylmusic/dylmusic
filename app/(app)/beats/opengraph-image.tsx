import { renderOgImage, OG_SIZE } from "@/lib/ogImageTemplate";

export const runtime = "nodejs";
export const alt = "Beats — Dyl";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  return renderOgImage({
    eyebrow: "BEATS",
    lines: ["Buy and lease beats", "from producers", "Coming soon"],
    tag: "PRODUCER MARKETPLACE",
  });
}
