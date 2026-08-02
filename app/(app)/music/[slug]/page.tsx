import type { Metadata } from "next";
import { ALBUMS } from "@/lib/albums";
import AlbumPageClient from "./album-client";

const SITE_URL = "https://nft.dylmusic.com";

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const album = ALBUMS.find((a) => a.slug === params.slug);
  if (!album) {
    return { title: "Album", description: "That album isn't available yet." };
  }
  const description = `${album.title} by ${album.artist} (${album.year}) — stream every track and collect numbered onchain Music NFT editions. Only 100 editions per song, per chain.`;
  return {
    title: album.title,
    description,
    keywords: ["Music NFTs", "Onchain Music", album.title, "NFTs", "Web3 Music"],
    openGraph: { title: `${album.title} | Dyl`, description, images: [{ url: album.coverImage }] },
    twitter: {
      card: "summary_large_image",
      title: `${album.title} | Dyl`,
      description,
      images: [album.coverImage],
    },
  };
}

// MusicAlbum/MusicRecording structured data — the core catalog pages had no
// per-page schema at all before this (only the root layout's site-wide
// WebSite/MusicGroup JSON-LD applied everywhere), so a rich-results crawler
// had nothing album-specific to key off. Only rendered for real albums with
// actual tracks — a comingSoon album with an empty tracklist has nothing
// genuine to describe yet.
function AlbumJsonLd({ album }: { album: (typeof ALBUMS)[number] }) {
  if (album.tracks.length === 0) return null;
  const url = `${SITE_URL}/music/${album.slug}`;
  const image = new URL(album.coverImage, SITE_URL).toString();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "MusicAlbum",
    name: album.title,
    url,
    image,
    datePublished: String(album.year),
    byArtist: { "@type": "MusicGroup", name: album.artist, url: SITE_URL },
    numTracks: album.tracks.length,
    track: album.tracks.map((t) => ({
      "@type": "MusicRecording",
      name: t.title,
      byArtist: { "@type": "MusicGroup", name: album.artist },
      inAlbum: album.title,
    })),
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

export default function AlbumPage({ params }: { params: { slug: string } }) {
  const album = ALBUMS.find((a) => a.slug === params.slug);
  return (
    <>
      {album && <AlbumJsonLd album={album} />}
      <AlbumPageClient params={params} />
    </>
  );
}
