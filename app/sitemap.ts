import type { MetadataRoute } from "next";
import { ALBUMS } from "@/lib/albums";

const SITE_URL = "https://nft.dylmusic.com";

// /admin, /chat, and /print are deliberately excluded — admin is gated and
// not meant to be indexed, /chat is a live message feed with no unique
// per-visit content to rank, and /print is the easter egg (see robots.ts
// for the matching disallow on /admin).
export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/music`, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/dashboard`, changeFrequency: "hourly", priority: 0.7 },
    { url: `${SITE_URL}/swap`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_URL}/burn`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_URL}/about`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/board`, changeFrequency: "daily", priority: 0.4 },
    { url: `${SITE_URL}/beats`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${SITE_URL}/memes`, changeFrequency: "monthly", priority: 0.5 },
  ];

  const albumPages: MetadataRoute.Sitemap = ALBUMS.map((album) => ({
    url: `${SITE_URL}/music/${album.slug}`,
    changeFrequency: "weekly",
    priority: album.comingSoon ? 0.5 : 0.9,
  }));

  return [...staticPages, ...albumPages];
}
