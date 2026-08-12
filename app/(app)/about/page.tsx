import type { Metadata } from "next";

const TITLE = "About";
const DESCRIPTION =
  "Dyl, the OG crypto rapper, on why he built the Dyl dApp — his own onchain Music NFT Streaming App — instead of relying on garbage third-party marketplaces.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "Music NFTs",
    "Onchain Music",
    "crypto rapper",
    "Web3 Music",
    "Dyl",
    "Dyl dApp",
    "Onchain Music dApp",
    "Music NFTs are back",
  ],
  openGraph: { title: `${TITLE} | Dyl`, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: `${TITLE} | Dyl`, description: DESCRIPTION },
};

const MESSAGE = `hey guys, i finally have the tools i need to make a sick ecosystem for onchain music. you can now burn all of my old NFTs and $Dyl coin and join the future of Music NFTs and onchain music. these are simple, fun song NFTs that are realistically priced. they have no utility, other than the cool stuff i build on this dapp. and the music of course. buy them for fun, enjoy the music, and add it on spotify. who knows, maybe we'll build something valuable.

music NFTs are back, and i'm here to save them from every rugged, overpriced, utility-obsessed project that came before. the Dyl dApp is my own onchain music dApp — $0.99 mints, 100 editions per song, 0% fees. that's it. that's the whole pitch.

- Dyl`;

export default function AboutPage() {
  return (
    <div className="about-wrap">
      <div className="dash-page-head">
        <div className="dash-eyebrow">About</div>
        <h1>What&apos;s going on here</h1>
      </div>

      <div className="about-readme">
        <div className="about-readme-titlebar">
          <span className="win95-titlebar-label">readme.txt</span>
        </div>
        <pre className="about-readme-body">{MESSAGE}</pre>
      </div>
    </div>
  );
}
