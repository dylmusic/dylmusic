"use client";

import Image from "next/image";
import { Album, CHAINS, ChainKey } from "@/lib/albums";
import ConsolePanel from "./ConsolePanel";
import BioSection from "./BioSection";

export default function Landing({
  chain,
  onSelectChain,
  onConnect,
  album,
}: {
  chain: ChainKey;
  onSelectChain: (chain: ChainKey) => void;
  onConnect: () => void;
  album: Album;
}) {
  const activeChain = CHAINS.find((c) => c.key === chain)!;

  return (
    <div className="landing-page">
      <div
        className="landing"
        style={{ "--glow-color": activeChain.color } as React.CSSProperties}
      >
        <div className="landing-grid" aria-hidden />
        <div className="landing-glow" aria-hidden />

        <div className="landing-inner">
        <div className="landing-content">
          <Image
            src="/brand/dyl-logo-white.png"
            alt="dyl"
            width={92}
            height={74}
            className="landing-logo"
            priority
          />

          <div className="landing-tagline">the OG crypto rapper</div>

          <h1>Only 100 NFTs per song on each chain</h1>

          <div className="landing-price">Every song starts at $5</div>

          <div className="landing-chain-select">
            <span className="landing-chain-label">Select blockchain</span>
            <div className="chain-switch landing-chain-switch" role="tablist" aria-label="Select chain">
              {CHAINS.map((c) => (
                <button
                  key={c.key}
                  role="tab"
                  aria-selected={chain === c.key}
                  className={`chain-pill${chain === c.key ? " active" : ""}`}
                  style={
                    chain === c.key
                      ? ({ "--chain-color": c.color } as React.CSSProperties)
                      : undefined
                  }
                  onClick={() => onSelectChain(c.key)}
                >
                  <span className="chain-dot" style={{ background: c.color }} />
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <button className="btn-connect" onClick={onConnect}>
            Connect Wallet
          </button>
        </div>

          <div className="landing-art">
            <ConsolePanel album={album} />
          </div>
        </div>
      </div>

      <BioSection />
    </div>
  );
}
