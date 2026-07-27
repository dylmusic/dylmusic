"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const STAR_ICON_PIXELS: [number, number][] = [
  [7, 1], [7, 2], [7, 3], [7, 4], [7, 5],
  [8, 1], [8, 2], [9, 2],
  [5, 5], [6, 5],
  [4, 6], [5, 6], [6, 6],
  [3, 7], [4, 7], [5, 7], [6, 7],
  [3, 8], [4, 8], [5, 8], [6, 8],
  [4, 9], [5, 9],
];

const NAV_ITEMS: { href: string; label: string; match: (p: string) => boolean }[] = [
  { href: "/music", label: "Music", match: (p) => p === "/music" || p.startsWith("/music/") },
  { href: "/dashboard", label: "Dashboard", match: (p) => p === "/dashboard" },
  { href: "/chat", label: "Chat", match: (p) => p === "/chat" },
  { href: "/swap", label: "Swap", match: (p) => p === "/swap" },
  { href: "/beats", label: "Beats", match: (p) => p === "/beats" },
];

// Persistent bottom taskbar, shared across every page — the anchor of the
// "whole site is a desktop" vibe. Each nav item reads as an open "window"
// button (pressed/inset when it's the active route), same idea as a real
// OS taskbar showing running apps.
export default function GlobalTaskbar({
  onStartClick,
}: {
  onStartClick?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [clock, setClock] = useState<string | null>(null);

  useEffect(() => {
    function tick() {
      setClock(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    }
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="site-taskbar">
      <button
        className="taskbar-start"
        onClick={onStartClick ?? (() => router.push("/"))}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" shapeRendering="crispEdges">
          {STAR_ICON_PIXELS.map(([x, y], i) => (
            <rect key={i} x={x} y={y} width="1" height="1" fill="#04140a" />
          ))}
        </svg>
        Start
      </button>

      <div className="taskbar-windows">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`taskbar-win-btn${item.match(pathname) ? " active" : ""}`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      <span className="taskbar-clock">{clock ?? "--:--"}</span>
    </div>
  );
}
