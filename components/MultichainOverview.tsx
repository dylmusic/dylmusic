"use client";

import { Album } from "@/lib/albums";
import { platformOverview } from "@/lib/platformStats";

export default function MultichainOverview({ album }: { album: Album }) {
  const overview = platformOverview(album);

  return (
    <div className="dash-wrap">
      <div className="dash-head">
        <div>
          <div className="dash-eyebrow">Multichain overview</div>
          <h1>{album.title}</h1>
        </div>
        <div className="dash-total">
          <span className="dash-total-num">{Math.round(overview.totalPct)}%</span>
          <span className="dash-total-label">
            sold across all chains · {overview.totalMinted.toLocaleString()}/
            {overview.totalCap.toLocaleString()} editions
          </span>
        </div>
      </div>

      <div className="dash-chains">
        {overview.perChain.map(({ chain, stat }) => (
          <div
            key={chain.key}
            className="dash-chain-card"
            style={{ "--chain-color": chain.color } as React.CSSProperties}
          >
            <div className="dash-chain-head">
              <span className="chain-dot" style={{ background: chain.color }} />
              <span className="dash-chain-name">{chain.label}</span>
              <span className="dash-chain-pct">{Math.round(stat.pct)}%</span>
            </div>
            <div className="dash-bar">
              <div className="dash-bar-fill" style={{ width: `${stat.pct}%` }} />
            </div>
            <div className="dash-chain-sub">
              {stat.minted.toLocaleString()} / {stat.cap.toLocaleString()} editions claimed
            </div>
          </div>
        ))}
      </div>

      <div className="dash-note">
        Every track: 100 numbered editions, per chain. Owning one is a real,
        tradeable collectible — list it any time for whatever you want.
      </div>
    </div>
  );
}
