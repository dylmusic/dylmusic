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
  { href: "/about", label: "About", match: (p) => p === "/about" },
  { href: "/dashboard", label: "Dashboard", match: (p) => p === "/dashboard" },
  { href: "/chat", label: "Chat", match: (p) => p === "/chat" },
  { href: "/swap", label: "Swap", match: (p) => p === "/swap" },
  { href: "/beats", label: "Beats", match: (p) => p === "/beats" },
  { href: "/burn", label: "Burn", match: (p) => p === "/burn" },
  { href: "/board", label: "Board", match: (p) => p === "/board" },
  { href: "/memes", label: "Memes", match: (p) => p === "/memes" },
  { href: "/print", label: "Print", match: (p) => p === "/print" },
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

  // Clicking the clock reveals today's date + live ETH/SOL price (and 24h
  // change) — a real CoinGecko fetch (same free, keyless /simple/price
  // endpoint, no server proxy needed, CORS is wide open on it), not a fake
  // number. Only fetched on demand when opened, not polled in the
  // background.
  const [pricesOpen, setPricesOpen] = useState(false);
  const [prices, setPrices] = useState<{
    eth: number | null;
    ethChange: number | null;
    sol: number | null;
    solChange: number | null;
  }>({ eth: null, ethChange: null, sol: null, solChange: null });
  const [pricesState, setPricesState] = useState<"idle" | "loading" | "error">("idle");

  function toggleClockPopup() {
    setPricesOpen((open) => {
      const next = !open;
      if (next) fetchPrices();
      return next;
    });
  }

  async function fetchPrices() {
    setPricesState("loading");
    try {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,solana&vs_currencies=usd&include_24hr_change=true"
      );
      const data = await res.json();
      setPrices({
        eth: data?.ethereum?.usd ?? null,
        ethChange: data?.ethereum?.usd_24h_change ?? null,
        sol: data?.solana?.usd ?? null,
        solChange: data?.solana?.usd_24h_change ?? null,
      });
      setPricesState("idle");
    } catch {
      setPricesState("error");
    }
  }

  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  // Mobile-only nudge: the nav row scrolls sideways (more pages than fit
  // on a phone), but nothing about it visually signals that — no
  // scrollbar (scrollbar-width:none), no visible cut-off edge. A single
  // snap-scroll-and-back read as a jarring bounce, not a hint — this
  // instead drifts very slowly right, pauses, drifts back, pauses, on
  // loop, so it's an obvious-but-gentle ongoing signal rather than a
  // one-shot. Stops for good the moment a real person touches/scrolls it
  // themselves, so it never fights actual use.
  useEffect(() => {
    const maybeEl = windowsRef.current;
    if (!maybeEl) return;
    if (window.innerWidth > 640) return;
    const el: HTMLDivElement = maybeEl;

    const PX_PER_SEC = 14; // slow drift, not a snap
    const PAUSE_MS = 1100;
    let rafId = 0;
    let startTimer = 0;
    let stopped = false;
    let direction: 1 | -1 = 1;
    let paused = false;
    let resumeAt = 0;
    let last = 0;
    // Tracked separately from el.scrollLeft, which the browser rounds to a
    // whole pixel on every write — at 14px/sec and a ~60fps rAF, each
    // frame's step is well under 1px, so reading el.scrollLeft back and
    // adding to it (the original approach) always re-reads the same
    // rounded-down integer and the fractional progress never accumulates,
    // permanently stuck at 0. A local float accumulator, written to
    // el.scrollLeft but never read back from it, fixes that.
    let pos = 0;

    function stop() {
      stopped = true;
      cancelAnimationFrame(rafId);
    }

    function step(now: number) {
      if (stopped) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 4) return;
      const dt = (now - last) / 1000;
      last = now;
      if (paused) {
        if (now >= resumeAt) paused = false;
      } else {
        pos += direction * PX_PER_SEC * dt;
        pos = Math.min(max, Math.max(0, pos));
        el.scrollLeft = pos;
        if (direction === 1 && pos >= max - 1) {
          direction = -1;
          paused = true;
          resumeAt = now + PAUSE_MS;
        } else if (direction === -1 && pos <= 1) {
          direction = 1;
          paused = true;
          resumeAt = now + PAUSE_MS;
        }
      }
      rafId = requestAnimationFrame(step);
    }

    startTimer = window.setTimeout(() => {
      pos = el.scrollLeft;
      last = performance.now();
      rafId = requestAnimationFrame(step);
    }, 1000);

    el.addEventListener("pointerdown", stop, { once: true });
    el.addEventListener("wheel", stop, { once: true });

    return () => {
      clearTimeout(startTimer);
      stop();
      el.removeEventListener("pointerdown", stop);
      el.removeEventListener("wheel", stop);
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

      <div className="taskbar-clock-wrap">
        {pricesOpen && (
          <>
            <div className="taskbar-clock-backdrop" onClick={() => setPricesOpen(false)} />
            <div className="taskbar-clock-popup">
              <div className="taskbar-clock-popup-head">Today</div>
              <div className="taskbar-clock-popup-date">{todayLabel}</div>
              <div className="taskbar-clock-popup-rows">
                <div className="taskbar-clock-popup-row">
                  <span>
                    <span className="chain-dot" style={{ background: "#8B8FA8" }} />
                    ETH
                  </span>
                  <span>
                    {pricesState === "loading"
                      ? "…"
                      : pricesState === "error" || prices.eth === null
                        ? "—"
                        : `$${prices.eth.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                  </span>
                  <PriceChange value={prices.ethChange} state={pricesState} />
                </div>
                <div className="taskbar-clock-popup-row">
                  <span>
                    <span className="chain-dot" style={{ background: "#9945FF" }} />
                    SOL
                  </span>
                  <span>
                    {pricesState === "loading"
                      ? "…"
                      : pricesState === "error" || prices.sol === null
                        ? "—"
                        : `$${prices.sol.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                  </span>
                  <PriceChange value={prices.solChange} state={pricesState} />
                </div>
              </div>
              {pricesState === "error" && (
                <div className="taskbar-clock-popup-error">Couldn&apos;t load prices.</div>
              )}
            </div>
          </>
        )}
        <button className="taskbar-clock" onClick={toggleClockPopup}>
          {clock ?? "--:--"}
        </button>
      </div>
    </div>
  );
}

function PriceChange({
  value,
  state,
}: {
  value: number | null;
  state: "idle" | "loading" | "error";
}) {
  if (state === "loading") return <span className="taskbar-clock-popup-change">…</span>;
  if (state === "error" || value === null) return <span className="taskbar-clock-popup-change">—</span>;
  const up = value >= 0;
  return (
    <span className={`taskbar-clock-popup-change ${up ? "up" : "down"}`}>
      {up ? "▲" : "▼"} {Math.abs(value).toFixed(2)}%
    </span>
  );
}
