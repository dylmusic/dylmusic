import { NextRequest, NextResponse } from "next/server";
import { ALBUMS, CHAINS } from "@/lib/albums";
import { decodeTokenId } from "@/lib/tokenIdScheme";

// Same real domain app/layout.tsx's own SITE_URL uses — image/animation_url
// must be absolute for marketplaces (OpenSea, Magic Eden) to resolve them.
const SITE_URL = "https://nft.dylmusic.com";

export async function GET(
  _req: NextRequest,
  { params }: { params: { chain: string; tokenId: string } }
) {
  const tokenId = Number(params.tokenId);
  if (!Number.isInteger(tokenId) || tokenId < 1) {
    return NextResponse.json({ error: "invalid tokenId" }, { status: 400 });
  }

  const chain = CHAINS.find((c) => c.key === params.chain);
  if (!chain) {
    return NextResponse.json({ error: "unknown chain" }, { status: 404 });
  }

  const { trackId, editionNumber } = decodeTokenId(tokenId);
  const track = ALBUMS.flatMap((a) => a.tracks.map((t) => ({ ...t, album: a }))).find(
    (t) => t.index === trackId
  );
  if (!track) {
    return NextResponse.json({ error: "no track for this tokenId" }, { status: 404 });
  }
  if (editionNumber < 1 || editionNumber > track.editionCap) {
    return NextResponse.json({ error: "edition number out of range" }, { status: 404 });
  }

  // Confirmed live against the real old Dyl collection (0x253bfce1...,
  // OpenSea) that a static `image` + `animation_url` pointing at the audio
  // file is exactly what renders as cover art with a play button — same
  // mechanism here, sourced from Track.audioSrc.
  //
  // Cache-Control: this response is deterministic from static lib/albums.ts
  // data — a given tokenId's metadata never changes after mint. Marketplaces
  // (OpenSea, Blockscout, wallets) re-crawl every tokenId's metadata
  // regularly, and with editions now actually minting there are hundreds of
  // distinct tokenIds to re-crawl — without this, every single one of those
  // was a fresh, uncached serverless invocation. s-maxage lets Vercel's edge
  // serve repeat crawls straight from cache instead of hitting the origin
  // every time; stale-while-revalidate keeps a track-title fix (rare) from
  // ever showing a hard-stale response for more than a day.
  return NextResponse.json(
    {
      name: track.title,
      description: `${track.album.title} by ${track.album.artist}, edition ${editionNumber} of ${track.editionCap}.`,
      image: `${SITE_URL}${track.album.coverImage}`,
      animation_url: `${SITE_URL}${track.audioSrc}`,
      attributes: [
        { trait_type: "Artist", value: track.album.artist },
        { trait_type: "Song", value: track.title },
        { trait_type: "Album", value: track.album.title },
        { trait_type: "Edition", value: editionNumber },
        { trait_type: "Chain", value: chain.label },
      ],
    },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } }
  );
}
