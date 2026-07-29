import type { Metadata } from "next";
import { ALBUMS } from "@/lib/albums";
import AlbumPageClient from "./album-client";

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const album = ALBUMS.find((a) => a.slug === params.slug);
  if (!album) {
    return { title: "Album", description: "That album isn't available yet." };
  }
  const description = `${album.title} by ${album.artist} (${album.year}) — stream every track and collect numbered onchain Music NFT editions. Only 100 editions per song, per chain.`;
  return {
    title: album.title,
    description,
    openGraph: { title: `${album.title} | Dyl`, description, images: [{ url: album.coverImage }] },
    twitter: {
      card: "summary_large_image",
      title: `${album.title} | Dyl`,
      description,
      images: [album.coverImage],
    },
  };
}

export default function AlbumPage({ params }: { params: { slug: string } }) {
  return <AlbumPageClient params={params} />;
}
