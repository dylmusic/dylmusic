"use client";

import { useEffect, useRef } from "react";
import { playSuccessChime } from "@/lib/successSound";

export interface MintSuccessInfo {
  trackTitle: string;
  editionNumber: number | null;
  priceUsd: number;
  trackCount?: number; // set for a whole-album buy
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  spin: number;
  color: string;
  life: number; // 0..1, counts down
}

// Hand-built pixel-square confetti, not a generic rounded-confetti library
// — small squares (matching the site's pixel/Windows-95 art direction, see
// TokenPickerModal-style pixel work elsewhere) burst upward from the
// title's icon, colored from the current chain accent + gold + white, then
// fall and fade under simple gravity. Runs on its own canvas + rAF loop,
// fully cleaned up on unmount so it can never leak into another view.
function useConfettiBurst(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;

    const dpr = window.devicePixelRatio || 1;
    function resize() {
      canvas!.width = window.innerWidth * dpr;
      canvas!.height = window.innerHeight * dpr;
      canvas!.style.width = `${window.innerWidth}px`;
      canvas!.style.height = `${window.innerHeight}px`;
      ctx2d!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    const accent = getComputedStyle(canvas).getPropertyValue("--accent").trim() || "#ccff00";
    const colors = [accent, "#ffd447", "#ffffff", "#ff5da0"];

    const originX = window.innerWidth / 2;
    const originY = window.innerHeight * 0.32;
    const particles: Particle[] = Array.from({ length: 140 }, () => {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 9;
      return {
        x: originX,
        y: originY,
        vx: Math.cos(angle) * speed * (0.4 + Math.random() * 0.6),
        vy: Math.sin(angle) * speed - 4 - Math.random() * 4,
        size: 4 + Math.random() * 6,
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.4,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 1,
      };
    });

    let raf = 0;
    let running = true;
    function tick() {
      if (!running) return;
      ctx2d!.clearRect(0, 0, canvas!.width, canvas!.height);
      let anyAlive = false;
      for (const p of particles) {
        if (p.life <= 0) continue;
        p.vy += 0.22; // gravity
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.spin;
        p.life -= 0.012;
        if (p.life > 0) {
          anyAlive = true;
          ctx2d!.save();
          ctx2d!.globalAlpha = Math.max(p.life, 0);
          ctx2d!.translate(p.x, p.y);
          ctx2d!.rotate(p.rotation);
          ctx2d!.fillStyle = p.color;
          ctx2d!.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
          ctx2d!.restore();
        }
      }
      if (anyAlive) {
        raf = requestAnimationFrame(tick);
      } else {
        ctx2d!.clearRect(0, 0, canvas!.width, canvas!.height);
      }
    }
    raf = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export default function MintSuccessModal({ info, onClose }: { info: MintSuccessInfo; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useConfettiBurst(canvasRef);

  useEffect(() => {
    let cancelled = false;
    playSuccessChime().then((played) => {
      if (played || cancelled) return;
      // iOS can revoke an earlier audio unlock across the MetaMask
      // app-switch, and a plain mount effect isn't a real user gesture —
      // the modal's own first tap is, so retry there instead of staying
      // silent for the rest of the session.
      const retry = () => {
        void playSuccessChime();
        window.removeEventListener("pointerdown", retry);
      };
      window.addEventListener("pointerdown", retry, { once: true });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const heading = info.trackCount
    ? `You minted the whole album!`
    : info.editionNumber != null
      ? `You minted edition #${info.editionNumber}!`
      : `You minted "${info.trackTitle}"!`;

  return (
    <>
      <canvas ref={canvasRef} className="mint-success-confetti" />
      {/* No backdrop onClick — this one has to be dismissed on purpose. */}
      <div className="modal-backdrop mint-success-backdrop">
        <div className="win95-window mint-success-window">
          <div className="win95-titlebar">
            <span className="win95-titlebar-label">PURCHASE_COMPLETE.exe</span>
            <div className="win95-controls">
              <div className="win95-dot" />
              <div className="win95-dot" />
              <div className="win95-dot" />
            </div>
          </div>
          <div className="win95-body mint-success-body">
            <div className="mint-success-icon" aria-hidden="true">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
                <path d="M5 12.5 10 17.5 19 6.5" stroke="#04140a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h3 className="mint-success-heading">{heading}</h3>
            {info.trackCount ? (
              <p className="mint-success-sub">
                {info.trackCount} tracks, ${info.priceUsd.toFixed(2)} total. Your Dyl collection just grew.
              </p>
            ) : (
              <p className="mint-success-sub">
                "{info.trackTitle}" · ${info.priceUsd.toFixed(2)}. It's yours, on-chain, for real.
              </p>
            )}
            <button className="mint-success-cta" onClick={onClose}>
              Nice!
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
