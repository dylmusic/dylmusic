import type { Metadata } from "next";
import "./globals.css";
import Providers from "@/components/Providers";
import { PlayerProvider } from "@/components/PlayerContext";
import DesktopBackground from "@/components/DesktopBackground";
import GlobalChatWidget from "@/components/GlobalChatWidget";

export const metadata: Metadata = {
  title: "Dyl - Music NFTs by the OG Crypto Rapper",
  description:
    "Only 100 NFTs per song, on each chain. Every mint starts at $0.99 — buy with any coin from any chain. Dyl's Crypto Rich (Deluxe), owned by the fans.",
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
