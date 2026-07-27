"use client";

import Image from "next/image";
import { CHAINS, ChainKey } from "@/lib/albums";

export default function Landing({
  chain,
  onSelectChain,
  onConnect,
}: {
  chain: ChainKey;
  onSelectChain: (chain: ChainKey) => void;
  onConnect: () => void;
}) {
  const activeChain = CHAINS.find((c) => c.key === chain)!;

  return (
    <div className="landing" style={{ "--glow-color": activeChain.color } as React.CSSProperties}>
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

          <h1>own the drop.</h1>
          <p>Only 100 NFTs per song, on each chain.</p>

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
          <div className="landing-art-frame">
            <Image
              src="/covers/crypto-rich-deluxe.jpg"
              alt="Crypto Rich (Deluxe)"
              fill
              sizes="(max-width: 900px) 280px, 380px"
              style={{ objectFit: "cover" }}
              priority
            />
          </div>
        </div>
      </div>
    </div>
  );
}
