import type { Metadata } from "next";
import "./globals.css";
import Providers from "@/components/Providers";
import { PlayerProvider } from "@/components/PlayerContext";
import DesktopBackground from "@/components/DesktopBackground";
import GlobalChatWidget from "@/components/GlobalChatWidget";

const SITE_URL = "https://dylmusic.vercel.app";
const TITLE = "Dyl - Music NFTs. Onchain Music. Crypto Rich.";
const DESCRIPTION =
  "Only 100 NFTs per song, on each chain. Every mint starts at $0.99 — buy with any coin from any chain. Dyl's Crypto Rich (Deluxe), owned by the fans.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
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
