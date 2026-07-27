"use client";

import { SalesDayPoint } from "@/lib/dashboardStats";

export default function SalesChart({ series }: { series: SalesDayPoint[] }) {
  const w = 640;
  const h = 160;
  const pad = 6;
  const max = Math.max(...series.map((d) => Math.max(d.buys, d.sells)), 1);

  const groupW = (w - pad * 2) / series.length;
  const barW = Math.min(10, groupW * 0.32);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="chart-svg" preserveAspectRatio="none">
      {series.map((d, i) => {
        const cx = pad + groupW * i + groupW / 2;
        const buyH = (d.buys / max) * (h - pad * 2);
        const sellH = (d.sells / max) * (h - pad * 2);
        return (
          <g key={i}>
            <rect
              x={cx - barW - 1}
              y={h - pad - buyH}
              width={barW}
              height={buyH}
              rx="2"
              fill="#7cff6b"
              fillOpacity={i === series.length - 1 ? 1 : 0.6}
            />
            <rect
              x={cx + 1}
              y={h - pad - sellH}
              width={barW}
              height={sellH}
              rx="2"
              fill="#ffb020"
              fillOpacity={i === series.length - 1 ? 1 : 0.6}
            />
          </g>
        );
      })}
    </svg>
  );
}
