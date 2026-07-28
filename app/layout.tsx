import type { Metadata } from "next";
import "./globals.css";
import Providers from "@/components/Providers";
import { PlayerProvider } from "@/components/PlayerContext";
import DesktopBackground from "@/components/DesktopBackground";
import GlobalChatWidget from "@/components/GlobalChatWidget";

// The real custom domain, not the dylmusic.vercel.app preview alias it was
// pointing at before (confirmed live: nft.dylmusic.com serves this exact
// site) — metadataBase/canonical/OG url/sitemap/robots should all resolve
// against the domain search engines and social crawlers actually see.
const SITE_URL = "https://nft.dylmusic.com";
const TITLE = "Dyl - Music NFTs. Onchain Music. Crypto Rich. Mint & Burn. $Dyl.";
const DESCRIPTION =
  "Only 100 NFTs per song, on each chain. Every mint starts at $0.99 — buy with any coin from any chain. Dyl's Crypto Rich (Deluxe), owned by the fans.";

// Every word here is deliberate — Dylan: "prioritize the words in our main
// site title - thats why i made it that title... perfectly SEO optimized."
// These are the same terms the title/description already lead with,
// repeated as explicit keywords (still read by Bing/Yahoo and some
// on-page-signal tooling even though Google itself ignores this specific
// tag) and threaded through each page's own title/description below
// rather than just dumped here once.
const KEYWORDS = [
  "Dyl",
  "$Dyl",
  "Music NFTs",
  "Onchain Music",
  "Crypto Rich",
  "Mint NFTs",
  "Burn NFTs",
  "Music NFT platform",
  "Web3 music",
  "crypto rapper",
  "NFT music collector",
  "Robinhood Chain NFTs",
  "Solana music NFTs",
  "Base music NFTs",
  "Ethereum music NFTs",
];

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s | Dyl" },
  description: DESCRIPTION,
  keywords: KEYWORDS,
  authors: [{ name: "Dyl" }],
  creator: "Dyl",
  alternates: { canonical: SITE_URL },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: "Dyl",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

// WebSite + MusicGroup structured data — the same real signals
// dylmusic.com's own Squarespace-generated JSON-LD carries (WebSite
// schema), plus a MusicGroup entry Squarespace's own boilerplate doesn't
// have, since this site's whole point is the music/NFT catalog. sameAs
// only lists verified-real URLs (the official site, and the @famous_dyl
// handle that site's own <title> tag itself references) — not guessed.
const JSON_LD = [
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: TITLE,
    url: SITE_URL,
    description: DESCRIPTION,
  },
  {
    "@context": "https://schema.org",
    "@type": "MusicGroup",
    name: "Dyl",
    url: SITE_URL,
    genre: "Hip Hop",
    sameAs: ["https://dylmusic.com", "https://x.com/famous_dyl"],
  },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
        <Providers>
          <PlayerProvider>
            <DesktopBackground />
            {children}
            <GlobalChatWidget />
          </PlayerProvider>
        </Providers>
      </body>
    </html>
  );
}
