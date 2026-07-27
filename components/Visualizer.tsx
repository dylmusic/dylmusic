"use client";

import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

const PARTICLE_COUNT = 110;
const LINK_DIST = 130;
const MOUSE_RADIUS = 160;

export default function Visualizer({
  color,
  analyser,
}: {
  color: string;
  analyser: AnalyserNode | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const mouseRef = useRef({ x: -9999, y: -9999, active: false });
  const pulseRef = useRef<{ r: number; alpha: number }[]>([]);
  const lastBassRef = useRef(0);
  const rafRef = useRef<number>();
  const colorRef = useRef(color);
  const analyserRef = useRef(analyser);

  colorRef.current = color;
  analyserRef.current = analyser;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      const parent = canvas!.parentElement;
      if (!parent) return;
      width = parent.clientWidth;
      height = parent.clientHeight;
      canvas!.width = width * dpr;
      canvas!.height = height * dpr;
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function initParticles() {
      particlesRef.current = Array.from({ length: PARTICLE_COUNT }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        r: Math.random() * 1.6 + 0.6,
      }));
    }

    resize();
    initParticles();

    const onResize = () => {
      resize();
    };
    const onMove = (e: PointerEvent) => {
      const rect = canvas!.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, active: true };
    };
    const onLeave = () => {
      mouseRef.current.active = false;
    };

    window.addEventListener("resize", onResize);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);

    const freqData = new Uint8Array(64);

    function frame() {
      ctx!.clearRect(0, 0, width, height);

      // audio energy (0..1), falls back to a gentle idle pulse when nothing's playing
      let bass = 0;
      let energy = 0;
      const a = analyserRef.current;
      if (a) {
        a.getByteFrequencyData(freqData);
        let bassSum = 0;
        for (let i = 0; i < 6; i++) bassSum += freqData[i];
        bass = bassSum / (6 * 255);
        let total = 0;
        for (let i = 0; i < freqData.length; i++) total += freqData[i];
        energy = total / (freqData.length * 255);
      } else {
        energy = 0.15 + Math.sin(Date.now() / 1400) * 0.05;
      }

      // bass transient -> spawn a pulse ring
      if (bass - lastBassRef.current > 0.18 && bass > 0.35) {
        pulseRef.current.push({ r: 10, alpha: 0.5 });
      }
      lastBassRef.current = bass;

      const speedMul = 1 + energy * 2.2;
      const col = colorRef.current;
      const mouse = mouseRef.current;
      const particles = particlesRef.current;

      // update + draw particles
      for (const p of particles) {
        p.x += p.vx * speedMul;
        p.y += p.vy * speedMul;

        if (mouse.active) {
          const dx = p.x - mouse.x;
          const dy = p.y - mouse.y;
          const dist = Math.hypot(dx, dy);
          if (dist < MOUSE_RADIUS && dist > 0.1) {
            const force = (1 - dist / MOUSE_RADIUS) * 0.6;
            p.vx += (dx / dist) * force * 0.06;
            p.vy += (dy / dist) * force * 0.06;
          }
        }

        p.vx *= 0.985;
        p.vy *= 0.985;

        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;

        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r + energy * 1.5, 0, Math.PI * 2);
        ctx!.fillStyle = col;
        ctx!.globalAlpha = 0.55 + energy * 0.4;
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;

      // connective lines
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.hypot(dx, dy);
          if (dist < LINK_DIST) {
            ctx!.beginPath();
            ctx!.moveTo(particles[i].x, particles[i].y);
            ctx!.lineTo(particles[j].x, particles[j].y);
            ctx!.strokeStyle = col;
            ctx!.globalAlpha = (1 - dist / LINK_DIST) * (0.14 + energy * 0.18);
            ctx!.lineWidth = 1;
            ctx!.stroke();
          }
        }
      }
      ctx!.globalAlpha = 1;

      // pulse rings (bass transients)
      pulseRef.current = pulseRef.current.filter((pulse) => pulse.alpha > 0.01);
      for (const pulse of pulseRef.current) {
        ctx!.beginPath();
        ctx!.arc(width / 2, height / 2, pulse.r, 0, Math.PI * 2);
        ctx!.strokeStyle = col;
        ctx!.globalAlpha = pulse.alpha;
        ctx!.lineWidth = 1.5;
        ctx!.stroke();
        pulse.r += 6;
        pulse.alpha *= 0.94;
      }
      ctx!.globalAlpha = 1;

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return <canvas ref={canvasRef} className="visualizer-canvas" />;
}
