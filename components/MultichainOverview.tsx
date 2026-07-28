"use client";

import { useEffect, useState } from "react";
import { Album } from "@/lib/albums";
import { platformOverview, usdToEth, historicalVolumeUsd } from "@/lib/platformStats";
import { streamsSeries, salesSeries } from "@/lib/dashboardStats";
import { formatStreams, useStreamCountsLoaded } from "@/lib/streams";
import StreamsChart from "./StreamsChart";
import SalesChart from "./SalesChart";
import RecentSales from "./RecentSales";

export default function MultichainOverview({ album }: { album: Album }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [volumeView, setVolumeView] = useState<"total" | "v2">("total");

  useEffect(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useStreamCountsLoaded();
  const overview = platformOverview(album);
  const streams = streamsSeries(album);
  const sales = salesSeries();

  // "Total Volume" folds in real historical volume from Dyl's pre-v2
  // collections (see lib/platformStats.ts historicalVolumeUsd — exact
  // figures Dylan supplied) on top of this v2 platform's own volume;
  // "V2 Volume" is this platform alone, same number the tile always
  // showed before this toggle existed.
  const v2VolumeUsd = overview.totalVolumeUsd;
  const totalVolumeUsd = historicalVolumeUsd() + v2VolumeUsd;
  const volumeUsd = volumeView === "total" ? totalVolumeUsd : v2VolumeUsd;
  const volumeEth = usdToEth(volumeUsd);

  return (
    <div className="dash-wrap">
      <div className="dash-page-head">
        <div className="dash-eyebrow">Dashboard</div>
        <h1>Dyl Music Stats</h1>
      </div>

      {/* ---------- Quick stats ---------- */}
      <div className="dash-quick-row">
        <button
          className="dash-quick-tile dash-quick-tile-click"
          onClick={() => setVolumeView((v) => (v === "total" ? "v2" : "total"))}
        >
          <span className="dash-quick-num">
            {volumeEth.toFixed(3)} <span className="dash-quick-unit">ETH</span>
          </span>
          <span className="dash-quick-usd">${volumeUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          {volumeView === "total" ? (
            <span className="dash-quick-label dash-vol-info" tabIndex={0}>
              Total Volume<span className="dash-vol-info-icon">ⓘ</span>
              <span className="dash-vol-tip" role="tooltip">
                Includes historical NFT trading volume across collections and $Dyl coin
              </span>
            </span>
          ) : (
            <span className="dash-quick-label">V2 Volume</span>
          )}
        </button>
        <div className="dash-quick-tile">
          <span className="dash-quick-num">{overview.totalMinted.toLocaleString()}</span>
          <span className="dash-quick-label">editions minted</span>
        </div>
        <div className="dash-quick-tile">
          <span className="dash-quick-num">{formatStreams(streams.total)}</span>
          <span className="dash-quick-label">total streams</span>
        </div>
        {/* Real zero, not a placeholder — burning isn't wired up on-chain
            yet (see /burn), so there's genuinely nothing to count. Same
            "show the true zero" call already made for RWA Pools. */}
        <div className="dash-quick-tile">
          <span className="dash-quick-num">0</span>
          <span className="dash-quick-label">NFTs burned</span>
        </div>
      </div>

      {/* ---------- Multichain / crypto (priority) ---------- */}
      <section className="dash-section">
        <div className="dash-section-head">
          <span className="dash-section-tag">On-chain</span>
          <div className="dash-total-inline">
            <span className="dash-total-num">{Math.round(overview.totalPct)}%</span>
            <span className="dash-total-label">
              sold · {overview.totalMinted.toLocaleString()}/{overview.totalCap.toLocaleString()} editions
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
      </section>

      {/* ---------- NFT sales ---------- */}
      <section className="dash-section">
        <div className="dash-section-head">
          <span className="dash-section-tag">NFT Sales</span>
        </div>

        <div className="dash-stat-row">
          <div className="dash-stat-tile">
            <span className="dash-stat-num accent-buy">${sales.avgBuyPrice.toFixed(2)}</span>
            <span className="dash-stat-label">avg buy price</span>
          </div>
          <div className="dash-stat-tile">
            <span className="dash-stat-num accent-sell">${sales.avgSellPrice.toFixed(2)}</span>
            <span className="dash-stat-label">avg ask price</span>
          </div>
          <div className="dash-stat-tile">
            <span className="dash-stat-num">{sales.buysToday}</span>
            <span className="dash-stat-label">buys today</span>
          </div>
          <div className="dash-stat-tile">
            <span className="dash-stat-num">{sales.sellsToday}</span>
            <span className="dash-stat-label">listed today</span>
          </div>
        </div>

        <div className="chart-card">
          <SalesChart series={sales.series} />
          <div className="chart-axis">
            <span>{sales.series[0].label}</span>
            <span className="chart-legend">
              <span className="legend-dot buy" /> buys <span className="legend-dot sell" /> sells
            </span>
            <span>{sales.series[sales.series.length - 1].label}</span>
          </div>
        </div>
      </section>

      {/* ---------- Recent transactions ---------- */}
      <section className="dash-section">
        <div className="dash-section-head">
          <span className="dash-section-tag">Recent Transactions</span>
        </div>
        <RecentSales refreshKey={refreshKey} />
      </section>

      {/* ---------- Streaming ---------- */}
      <section className="dash-section">
        <div className="dash-section-head">
          <span className="dash-section-tag">Streaming</span>
        </div>

        <div className="dash-stat-row">
          <div className="dash-stat-tile">
            <span className="dash-stat-num">{formatStreams(streams.total)}</span>
            <span className="dash-stat-label">total streams</span>
          </div>
          <div className="dash-stat-tile">
            <span className="dash-stat-num">{formatStreams(streams.topCount)}</span>
            <span className="dash-stat-label">top track · {streams.topTrack}</span>
          </div>
          <div className="dash-stat-tile">
            <span className="dash-stat-num">{formatStreams(Math.round(streams.total / album.tracks.length))}</span>
            <span className="dash-stat-label">avg per track</span>
          </div>
        </div>

        <div className="chart-card">
          <StreamsChart series={streams.series} />
          <div className="chart-axis">
            <span>{streams.series[0].label}</span>
            <span>{streams.series[streams.series.length - 1].label}</span>
          </div>
        </div>
      </section>

      <div className="dash-note">
        Every track: 100 numbered editions, per chain. Owning one is a real,
        tradeable collectible — list it any time for whatever you want.
      </div>
    </div>
  );
}
