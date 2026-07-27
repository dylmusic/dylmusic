"use client";

import { DayPoint } from "@/lib/dashboardStats";

export default function StreamsChart({ series }: { series: DayPoint[] }) {
  const w = 640;
  const h = 160;
  const pad = 6;
  const max = Math.max(...series.map((d) => d.value), 1);

  const stepX = (w - pad * 2) / (series.length - 1);
  const points = series.map((d, i) => {
    const x = pad + i * stepX;
    const y = pad + (1 - d.value / max) * (h - pad * 2);
    return { x, y, ...d };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1].x},${h - pad} L${points[0].x},${h - pad} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="chart-svg" preserveAspectRatio="none">
      <defs>
        <linearGradient id="streamsFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7cff6b" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#7cff6b" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#streamsFill)" />
      <path d={linePath} fill="none" stroke="#7cff6b" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={i === points.length - 1 ? 3.5 : 0} fill="#7cff6b" />
      ))}
    </svg>
  );
}
