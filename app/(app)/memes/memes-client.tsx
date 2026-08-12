"use client";

import { useState } from "react";
import { CHAINS, type ChainKey } from "@/lib/albums";
import { MEMES } from "@/lib/memes";

export default function MemesPageClient() {
  const [chain, setChain] = useState<ChainKey>("robinhood");
  const activeChain = CHAINS.find((c) => c.key === chain)!;

  return (
    <div className="dash-wrap memes-wrap">
      <div className="dash-page-head">
        <h1>Music NFTs Are Back.</h1>
      </div>

      <div className="landing-chain-select memes-chain-select">
        <div className="chain-switch" role="tablist" aria-label="Select chain colorway">
          {CHAINS.map((c) => (
            <button
              key={c.key}
              role="tab"
              aria-selected={chain === c.key}
              className={`chain-pill${chain === c.key ? " active" : ""}`}
              style={chain === c.key ? ({ "--chain-color": c.color } as React.CSSProperties) : undefined}
              onClick={() => setChain(c.key)}
            >
              <span className="chain-dot" style={{ background: c.color }} />
              {c.shortLabel}
            </button>
          ))}
        </div>
      </div>

      <div className="memes-grid">
        {MEMES.map((meme) => {
          const src = `/memes/${chain}/${meme.slug}.png`;
          return (
            <div className="win95-window memes-card" key={meme.slug}>
              <div className="win95-titlebar" style={{ background: activeChain.color }}>
                <span className="win95-titlebar-label">DYL.exe — {activeChain.label}</span>
                <div className="win95-controls">
                  <div className="win95-dot" />
                  <div className="win95-dot" />
                  <div className="win95-dot" />
                </div>
              </div>
              <div className="win95-body memes-card-body">
                <img src={src} alt={`${meme.headline} ${meme.subtext} — Dyl Music NFT meme, ${activeChain.label} colorway`} loading="lazy" />
                <div className="memes-caption">
                  <div className="memes-caption-headline">{meme.headline}</div>
                  <div className="memes-caption-subtext">{meme.subtext}</div>
                </div>
                <a className="memes-download" href={src} download={`dyl-meme-${meme.slug}-${chain}.png`}>
                  Download ↓
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
