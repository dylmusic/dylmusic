"use client";

// A deliberately obnoxious, deliberately funny homage to a genuine
// late-90s/early-2000s popup ad — Dylan's own words: "I want this to make
// a little popup that feels like an oldschool popup advertisement for
// PRINT... spend the time and effort to make it feel like a genuinely
// creative and funny easter egg." $PRINT (hoodprinter.xyz) is a real
// sibling project this repo's own author also works on — this is a real
// cross-promo, not a prank on the user, so the CTA link is real and the
// close button is genuinely one click, no dark patterns, just the JOKE of
// dark patterns (the fake second "guilt" button, the fake visitor counter,
// the marquee, the blink).
export default function PrintAdModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="print-ad-backdrop" onClick={onClose}>
      <div className="print-ad-window" onClick={(e) => e.stopPropagation()}>
        <div className="print-ad-titlebar">
          <span className="print-ad-titlebar-label">
            <span className="print-ad-titlebar-icon">🖨️</span>
            SYSTEM_ALERT.exe — DO NOT CLOSE
          </span>
          <button className="print-ad-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="print-ad-marquee">
          <span>
            ✦彡 YOU HAVE BEEN RANDOMLY SELECTED 彡✦ ACT NOW BEFORE THIS WINDOW CLOSES ITSELF
            彡✦ CONGRATULATIONS ARE IN ORDER 彡✦ YOU HAVE BEEN RANDOMLY SELECTED 彡✦ ACT NOW
            BEFORE THIS WINDOW CLOSES ITSELF 彡✦ CONGRATULATIONS ARE IN ORDER 彡✦
          </span>
        </div>

        <div className="print-ad-body">
          <div className="print-ad-badge">★ NEW ★</div>

          <div className="print-ad-logo">$PRINT</div>
          <div className="print-ad-tagline">
            5% REWARDS PAID IN REAL ETH!!
            <br />
            ON ROBINHOOD CHAIN!! POWERED BY RWAs!!
          </div>

          <div className="print-ad-emojis" aria-hidden="true">
            💰 🖨️ 💸 🚀 💰 🖨️ 💸 🚀
          </div>

          <div className="print-ad-counter">
            YOU ARE VISITOR <span>#0013337</span> TO SEE THIS OFFER TODAY
          </div>

          <div className="print-ad-ctas">
            <a
              className="print-ad-buy"
              href="https://hoodprinter.xyz/swap"
              target="_blank"
              rel="noopener noreferrer"
            >
              💰 BUY $PRINT NOW 💰
            </a>
            <button className="print-ad-no" onClick={onClose}>
              NO THANKS (I hate free ETH)
            </button>
          </div>

          <div className="print-ad-fine">
            *not a virus. side effects may include passive income. results not typical, except
            they kind of are, it&apos;s just math. void where prohibited (nowhere).
          </div>
        </div>
      </div>
    </div>
  );
}
