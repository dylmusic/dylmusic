"use client";

// A short retro "achievement" arpeggio, synthesized entirely via Web Audio
// oscillators — no bundled audio asset to source/license, tiny, instant,
// and square-wave gives it the 8-bit/chiptune character that matches the
// site's Windows-95 pixel aesthetic better than a real recorded chime would.

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}

/**
 * Call this SYNCHRONOUSLY inside a real user-gesture handler — e.g. the
 * "Confirm Buy" button's own onClick, before any `await`. Browsers only
 * allow an AudioContext to start/resume within a direct user gesture; the
 * actual purchase and success celebration happen well after that gesture
 * (behind several async awaits), so a context created fresh at that point
 * would often be silently blocked. Unlocking it here, at the moment of the
 * click that eventually leads there, keeps it already running by then.
 */
export function unlockSuccessSound() {
  const c = getContext();
  if (c && c.state === "suspended") void c.resume();
}

/**
 * Returns whether it actually played. On mobile Safari, backgrounding the
 * tab to approve a transaction in MetaMask can re-suspend (or on iOS,
 * fully revoke) an AudioContext that was successfully unlocked earlier —
 * `resume()` is async and can also just never resolve without a fresh
 * user gesture, so this is `await`ed and checked rather than fired and
 * forgotten (the old version called `c.resume()` without awaiting it,
 * then scheduled oscillators anyway — silent when resume hadn't actually
 * finished). Callers that get `false` back should retry on the next real
 * tap, which is guaranteed to be a valid gesture.
 */
export async function playSuccessChime(): Promise<boolean> {
  const c = getContext();
  if (!c) return false;
  if (c.state === "suspended") {
    try {
      await c.resume();
    } catch {
      // ignore — checked below via c.state
    }
  }
  if (c.state !== "running") return false;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6 — classic rising "achievement" shape
  const start = c.currentTime;
  notes.forEach((freq, i) => {
    const t = start + i * 0.09;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.15, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.3);
  });
  return true;
}
