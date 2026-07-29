import { ImageResponse } from "next/og";
import { readFile } from "fs/promises";
import { join } from "path";

// Shared chrome for every non-album OG image (album pages use their own
// real cover art instead — see music/[slug]/page.tsx). Every page that
// isn't the homepage was missing its own openGraph/twitter image entirely,
// which meant sharing ANY of them (Beats, Swap, Dashboard, etc.) silently
// fell back to the homepage's own OG image and title — this is what fixes
// that, reusing the exact Win95-window look the homepage's own
// app/opengraph-image.tsx already established rather than inventing a
// second visual style.

export const OG_SIZE = { width: 1200, height: 630 };

const ACCENT = "#ccff00";
const BG = "#05070a";
const INK = "#eef2ee";

export async function renderOgImage({
  eyebrow,
  lines,
  tag,
}: {
  eyebrow: string;
  lines: string[];
  // Small right-aligned taskbar label, e.g. "MUSIC NFTS · ONCHAIN" on the
  // homepage — a short category tag, not a full sentence.
  tag: string;
}) {
  const [regular, bold, extraBold, logo] = await Promise.all([
    readFile(join(process.cwd(), "public/fonts/JetBrainsMono-Regular.ttf")),
    readFile(join(process.cwd(), "public/fonts/JetBrainsMono-Bold.ttf")),
    readFile(join(process.cwd(), "public/fonts/JetBrainsMono-ExtraBold.ttf")),
    readFile(join(process.cwd(), "public/brand/dyl-logo-white.png")),
  ]);
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: BG,
          fontFamily: "JetBrains Mono",
        }}
      >
        {/* ---- window ---- */}
        <div
          style={{
            width: 1080,
            height: 534,
            display: "flex",
            flexDirection: "column",
            background: "#0a0e0c",
            borderTop: "3px solid rgba(255,255,255,0.4)",
            borderLeft: "3px solid rgba(255,255,255,0.4)",
            borderRight: "5px solid rgba(255,255,255,0.14)",
            borderBottom: "5px solid rgba(255,255,255,0.14)",
          }}
        >
          {/* title bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              height: 60,
              padding: "0 28px",
              background: ACCENT,
              color: "#04140a",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 999,
                  background: "#04140a",
                }}
              />
              <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 2 }}>DYL.EXE</div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              {["_", "sq", "X"].map((glyph) => (
                <div
                  key={glyph}
                  style={{
                    width: 34,
                    height: 34,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                    fontWeight: 700,
                    background: "rgba(4,20,10,0.16)",
                    borderTop: "2px solid rgba(255,255,255,0.6)",
                    borderLeft: "2px solid rgba(255,255,255,0.6)",
                    borderRight: "2px solid rgba(0,0,0,0.35)",
                    borderBottom: "2px solid rgba(0,0,0,0.35)",
                  }}
                >
                  {glyph === "sq" ? (
                    <div style={{ width: 10, height: 10, border: "2px solid #04140a" }} />
                  ) : (
                    glyph
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* body */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 18,
            }}
          >
            <img src={logoSrc} width={72} height={58} alt="" />

            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: 6, color: ACCENT }}>
              {eyebrow}
            </div>

            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              {lines.map((line) => (
                <div key={line} style={{ fontSize: 34, fontWeight: 600, color: INK }}>
                  {line}
                </div>
              ))}
            </div>
          </div>

          {/* taskbar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              height: 56,
              padding: "0 28px",
              background: ACCENT,
              color: "#04140a",
              borderTop: "3px solid rgba(255,255,255,0.5)",
            }}
          >
            <div style={{ fontSize: 26, fontWeight: 800 }}>nft.dylmusic.com</div>
            <div style={{ fontSize: 16, fontWeight: 700, opacity: 0.75 }}>{tag}</div>
          </div>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: "JetBrains Mono", data: regular, weight: 400, style: "normal" },
        { name: "JetBrains Mono", data: bold, weight: 700, style: "normal" },
        { name: "JetBrains Mono", data: extraBold, weight: 800, style: "normal" },
      ],
    }
  );
}
