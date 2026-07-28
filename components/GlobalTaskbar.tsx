"use client";

import { useEffect, useRef, useState } from "react";
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
  { href: "/burn", label: "Burn", match: (p) => p === "/burn" },
  { href: "/board", label: "Board", match: (p) => p === "/board" },
  { href: "/about", label: "About", match: (p) => p === "/about" },
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
  const windowsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function tick() {
      setClock(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    }
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);

  // Mobile-only nudge: the nav row scrolls sideways (more pages than fit
  // on a phone), but nothing about it visually signals that — no
  // scrollbar (scrollbar-width:none), no visible cut-off edge. Once,
  // shortly after mount, slide it right and back so first-time visitors
  // notice it's draggable, same idea as the trending row hint in the
  // sibling hoodprinter project.
  useEffect(() => {
    const el = windowsRef.current;
    if (!el) return;
    if (window.innerWidth > 640) return;
    if (el.scrollWidth <= el.clientWidth + 4) return;

    const hintDistance = Math.min(90, el.scrollWidth - el.clientWidth);
    const showTimer = setTimeout(() => {
      el.scrollTo({ left: hintDistance, behavior: "smooth" });
    }, 1000);
    const backTimer = setTimeout(() => {
      el.scrollTo({ left: 0, behavior: "smooth" });
    }, 2600);
    return () => {
      clearTimeout(showTimer);
      clearTimeout(backTimer);
    };
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

      <div className="taskbar-windows" ref={windowsRef}>
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
