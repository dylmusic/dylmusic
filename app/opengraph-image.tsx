import { ImageResponse } from "next/og";
import { readFile } from "fs/promises";
import { join } from "path";

export const runtime = "nodejs";
export const alt = "Dyl - Music NFTs. Onchain Music. Crypto Rich.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const ACCENT = "#ccff00";
const BG = "#05070a";
const INK = "#eef2ee";
// Red/orange, OG-image-only — everywhere else on the site the burn CTA is
// the same lime accent as every other button (see .btn-burn-hero), but on
// a small social-preview thumbnail a same-color button blends into the
// title bar/taskbar instead of standing out as its own distinct action.
const BURN_RED = "#ff4d2e";

// Deliberately generic — no album art, no per-release copy. This is meant
// to sit on the share card for every album that ever ships, so it only
// draws the site's own Windows-95-style chrome (title bar, bevels, taskbar)
// plus the wordmark and evergreen "how this works" tagline lines, the same
// three lines the homepage hero itself uses.
export default async function Image() {
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
              <div
                style={{
                  fontSize: 26,
                  fontWeight: 800,
                  letterSpacing: 2,
                }}
              >
                DYL.EXE
              </div>
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
              gap: 14,
            }}
          >
            <img src={logoSrc} width={80} height={64} alt="" />

            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                letterSpacing: 6,
                color: ACCENT,
              }}
            >
              THE OG CRYPTO RAPPER
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
              }}
            >
              <div style={{ fontSize: 32, fontWeight: 700, color: INK }}>
                Every mint starts at $0.99
              </div>
              <div style={{ fontSize: 32, fontWeight: 500, color: INK }}>
                Buy with any coin from any chain
              </div>
              <div style={{ fontSize: 32, fontWeight: 500, color: INK }}>
                Only 100 NFTs per song, on each chain
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                fontSize: 30,
                fontWeight: 800,
                color: "#fff",
                background: BURN_RED,
                padding: "18px 40px",
                borderTop: "3px solid rgba(255,255,255,0.55)",
                borderLeft: "3px solid rgba(255,255,255,0.55)",
                borderRight: "3px solid rgba(0,0,0,0.5)",
                borderBottom: "3px solid rgba(0,0,0,0.5)",
              }}
            >
              Burn Old NFTs &amp; $Dyl Coin
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
            <div style={{ fontSize: 16, fontWeight: 700, opacity: 0.75 }}>
              MUSIC NFTS · ONCHAIN
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "JetBrains Mono", data: regular, weight: 400, style: "normal" },
        { name: "JetBrains Mono", data: bold, weight: 700, style: "normal" },
        { name: "JetBrains Mono", data: extraBold, weight: 800, style: "normal" },
      ],
    }
  );
}
