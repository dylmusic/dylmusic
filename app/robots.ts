import type { MetadataRoute } from "next";

const SITE_URL = "https://nft.dylmusic.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Wallet-gated admin tooling — nothing here has any public/indexable
      // value and it shouldn't show up in search results at all.
      disallow: ["/admin"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
