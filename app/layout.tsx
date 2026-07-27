import type { Metadata } from "next";
import "./globals.css";
import Providers from "@/components/Providers";

export const metadata: Metadata = {
  title: "dyl — Own the Drop",
  description:
    "Only 100 NFTs per song, on each chain. Every mint starts at $0.99 — buy with any coin from any chain. dyl's Crypto Rich (Deluxe), owned by the fans.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
