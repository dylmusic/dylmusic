"use client";

import { useEffect, useState } from "react";
import { Album } from "@/lib/albums";
import { platformOverview, usdToEth, usdToSol } from "@/lib/platformStats";
import { streamsSeries, salesSeries } from "@/lib/dashboardStats";
import { formatStreams, useStreamCountsLoaded } from "@/lib/streams";
import StreamsChart from "./StreamsChart";
import SalesChart from "./SalesChart";
import RecentSales from "./RecentSales";

export default function MultichainOverview({ album }: { album: Album }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [volumeCurrency, setVolumeCurrency] = useState<"ETH" | "SOL">("ETH");

  useEffect(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useStreamCountsLoaded();
  const overview = platformOverview(album);
  const streams = streamsSeries(album);
  const sales = salesSeries();

  const volumeDisplay =
    volumeCurrency === "ETH"
      ? usdToEth(overview.totalVolumeUsd).toFixed(3)
      : usdToSol(overview.totalVolumeUsd).toFixed(2);

  return (
    <div className="dash-wrap">
      <div className="dash-page-head">
        <div className="dash-eyebrow">Dashboard</div>
        <h1>Platform Overview</h1>
        <p className="swap-page-sub">Every chain, every track — starting with {album.title}.</p>
      </div>

      {/* ---------- Quick stats ---------- */}
      <div className="dash-quick-row">
        <button
          className="dash-quick-tile dash-quick-tile-click"
          onClick={() => setVolumeCurrency((c) => (c === "ETH" ? "SOL" : "ETH"))}
          title="Click to switch currency"
        >
          <span className="dash-quick-num">
            {volumeDisplay} <span className="dash-quick-unit">{volumeCurrency}</span>
          </span>
          <span className="dash-quick-label">total volume</span>
        </button>
        <div className="dash-quick-tile">
          <span className="dash-quick-num">{overview.totalMinted.toLocaleString()}</span>
          <span className="dash-quick-label">editions minted</span>
        </div>
        <div className="dash-quick-tile">
          <span className="dash-quick-num">{formatStreams(streams.total)}</span>
          <span className="dash-quick-label">total streams</span>
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
