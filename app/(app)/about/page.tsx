import Image from "next/image";

interface Bubble {
  text: string;
}

// Written in Dyl's own voice, AIM-bubble style — same .aim-msg component the
// homepage's mini chat preview uses, just a longer run of them and not
// clickable (there's nothing to navigate to, this IS the explanation).
const BUBBLES: Bubble[] = [
  {
    text: "yo — I'm Dyl. Been rapping about crypto since before it was a trend. “Jordan Belfort” dropped in 2015, climbed to #25 on Billboard, 200+ shows. Then I went all in on Web3 instead of stopping there.",
  },
  {
    text: "This site is dylmusic — my own music, minted as NFTs. Only 100 editions per song, on each chain. No label, no streaming platform skimming off the top.",
  },
  {
    text: "Right now that's Robinhood Chain, Base, and Solana. Every mint starts at $0.99 and floats from there — buy an edition, resell it if you want. It's a real little market per song, not just a static price tag.",
  },
  {
    text: "I had older drops before this one too — trading cards, a PFP set, stuff on Tezos and Solana. If you're holding any of that, /burn is where you turn it into free mints on the new collection.",
  },
  {
    text: "/board is the community wall — pin a note, everyone can see it, no gatekeeping. /chat (bottom-right, any page) is the live room if you actually want to talk to people.",
  },
  {
    text: "Full transparency: this is still early. Real contracts aren't deployed yet, burning isn't wired up yet — but the whole plan's out in the open on every page, nothing hidden behind a whitepaper nobody reads.",
  },
  {
    text: "wagmi. — Dyl",
  },
];

export default function AboutPage() {
  return (
    <div className="about-wrap">
      <div className="dash-page-head">
        <div className="dash-eyebrow">About</div>
        <h1>What&apos;s going on here</h1>
        <p className="swap-page-sub">Straight from Dyl, AIM-style.</p>
      </div>

      <div className="aim-mini-window about-window">
        <div className="aim-mini-titlebar">
          <span className="aim-titlebar-dot" />
          Dyl
        </div>
        <div className="aim-mini-body">
          {BUBBLES.map((b, i) => (
            <div className="aim-msg about-msg" key={i}>
              <Image
                src="/brand/dyl-pfp.png"
                alt="Dyl"
                width={32}
                height={32}
                className="aim-msg-avatar"
              />
              <span className="aim-msg-body">
                <span className="aim-msg-name">
                  Dyl <span className="aim-msg-dot" />
                </span>
                <span className="aim-msg-text">{b.text}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
