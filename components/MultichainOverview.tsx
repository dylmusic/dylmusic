"use client";

import { useEffect, useState } from "react";
import { Album } from "@/lib/albums";
import {
  fetchRealPlatformOverview,
  fetchRealHoldersCount,
  fetchRealFullSetHolders,
  usdToEth,
  historicalVolumeUsd,
  type PlatformOverview,
} from "@/lib/platformStats";
import { streamsSeries, fetchRealSalesStats, EMPTY_SALES_STATS, type RealSalesStats } from "@/lib/dashboardStats";
import { formatStreams, useStreamCountsLoaded } from "@/lib/streams";
import { readCachedNumber, writeCachedNumber, readCachedJson, writeCachedJson } from "@/lib/localCache";
import StreamsChart from "./StreamsChart";
import SalesChart from "./SalesChart";
import RecentSales from "./RecentSales";

const EMPTY_OVERVIEW: PlatformOverview = { perChain: [], totalMinted: 0, totalCap: 0, totalPct: 0 };

export default function MultichainOverview({ album }: { album: Album }) {
  const [overview, setOverview] = useState<PlatformOverview>(
    () => readCachedJson<PlatformOverview>("platformOverview") ?? EMPTY_OVERVIEW
  );
  const [sales, setSales] = useState<RealSalesStats>(EMPTY_SALES_STATS);
  // Seeded from the last real read this browser saw (see lib/localCache.ts)
  // so these tiles show a real last-known number instead of "0" on every
  // dashboard load while the real Blockscout reads below are still running.
  const [holders, setHolders] = useState(() => readCachedNumber("holders") ?? 0);
  const [fullSetHolders, setFullSetHolders] = useState(() => readCachedNumber("fullSetHolders") ?? 0);
  const [volumeView, setVolumeView] = useState<"total" | "v2">("total");
  const [burnedView, setBurnedView] = useState<"nfts" | "coin">("nfts");
  // Tooltip visibility is click-driven (not just CSS :hover/:focus) because
  // the info label sits inside the same tile that toggles Total/V2 on
  // click — mobile has no hover at all, so tapping "Total Volume ⓘ" to
  // read the tooltip was landing on the tile's own onClick instead and
  // just flipping straight to V2 Volume before the tip ever showed
  // (confirmed live). stopPropagation on the label's own click (below)
  // is what actually stops that; this state is what makes tapping it
  // show the tip instead of doing nothing.
  const [showVolTip, setShowVolTip] = useState(false);

  // Real platform stats (mint counts + sales/activity), fetched once on
  // mount — replaces the old synchronous platformOverview()/salesSeries()
  // calls, both entirely simulated before this. See lib/platformStats.ts
  // and lib/dashboardStats.ts for what "real" means for each.
  useEffect(() => {
    let cancelled = false;
    fetchRealPlatformOverview(album).then((o) => {
      if (!cancelled) setOverview(o);
      writeCachedJson("platformOverview", o);
    });
    fetchRealSalesStats().then((s) => {
      if (!cancelled) setSales(s);
    });
    fetchRealHoldersCount().then((h) => {
      if (!cancelled) setHolders(h);
      writeCachedNumber("holders", h);
    });
    fetchRealFullSetHolders(album).then((n) => {
      if (!cancelled) setFullSetHolders(n);
      writeCachedNumber("fullSetHolders", n);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [album.slug]);

  useStreamCountsLoaded();
  const streams = streamsSeries(album);

  // "Total Volume" folds in real historical volume from Dyl's pre-v2
  // collections (see lib/platformStats.ts historicalVolumeUsd — exact
  // figures Dylan supplied) on top of this v2 platform's own REAL volume
  // (sum of actually-reported real buy transactions, not a mint-count
  // multiply); "V2 Volume" is this platform alone, same number the tile
  // always showed before this toggle existed.
  const v2VolumeUsd = sales.totalVolumeUsd;
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
            <span
              className="dash-quick-label dash-vol-info"
              tabIndex={0}
              role="button"
              aria-label="Total Volume info"
              onClick={(e) => {
                // Without this, the click bubbles to the parent tile's
                // onClick and toggles to V2 Volume instead of showing the
                // tip — see the showVolTip comment above.
                e.stopPropagation();
                setShowVolTip((v) => !v);
              }}
            >
              Total Volume<span className="dash-vol-info-icon">ⓘ</span>
              <span className={`dash-vol-tip${showVolTip ? " show" : ""}`} role="tooltip">
                Includes historical NFT trading volume across collections and $Dyl coin
                {/* A dedicated close button, not just tap-the-flag-to-close —
                    mobile Safari's own hover-then-click quirk made the
                    tap-anywhere approach unreliable (sometimes needed 2
                    taps), so this is a plain, unambiguous single-tap close
                    that never depends on hover state at all. */}
                <button
                  type="button"
                  className="dash-vol-tip-close"
                  aria-label="Close"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowVolTip(false);
                  }}
                >
                  ✕
                </button>
              </span>
            </span>
          ) : (
            <span className="dash-quick-label">V2 Volume</span>
          )}
        </button>
        <div className="dash-quick-tile">
          <span className="dash-quick-num">{overview.totalMinted.toLocaleString()}</span>
          <span className="dash-quick-label">songs minted</span>
        </div>
        <div className="dash-quick-tile">
          <span className="dash-quick-num">{formatStreams(streams.total)}</span>
          <span className="dash-quick-label">total streams</span>
        </div>
        {/* Real distinct-holder count (Blockscout's own holders_count for
            the Robinhood Chain collection — see fetchRealHoldersCount) —
            not a placeholder, same real-data rule as every other tile here. */}
        <div className="dash-quick-tile">
          <span className="dash-quick-num">{holders.toLocaleString()}</span>
          <span className="dash-quick-label">Holders</span>
        </div>
        {/* Real platform-wide audit, not a placeholder — how many distinct
            wallets currently hold at least one edition of every track
            (see fetchRealFullSetHolders: intersects real per-track owner
            sets from Blockscout's own instance data). */}
        <div className="dash-quick-tile">
          <span className="dash-quick-num">{fullSetHolders.toLocaleString()}</span>
          <span className="dash-quick-label">Full Albums Collected</span>
        </div>
        {/* Real zero either way, not a placeholder — burning isn't wired up
            on-chain yet (see /burn), so there's genuinely nothing to count
            for NFTs or $Dyl coin. Same "show the true zero" call already
            made for RWA Pools. Click toggles which one is shown, same
            pattern as the Total/V2 Volume tile above. Moved to the end of
            the row to make room for Holders above (Dylan: "move Dyl coin
            burned down to the open spot"). */}
        <button
          className="dash-quick-tile dash-quick-tile-click"
          onClick={() => setBurnedView((v) => (v === "nfts" ? "coin" : "nfts"))}
        >
          <span className="dash-quick-num">0</span>
          <span className="dash-quick-label">
            {burnedView === "nfts" ? "NFTs burned" : "$Dyl Coin burned"}
          </span>
        </button>
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
        <RecentSales entries={sales.recent} />
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
