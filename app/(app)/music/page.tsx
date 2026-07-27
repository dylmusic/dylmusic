"use client";

import { useRouter } from "next/navigation";
import { ALBUMS, Album } from "@/lib/albums";
import MusicGrid from "@/components/MusicGrid";

export default function MusicPage() {
  const router = useRouter();

  function openAlbum(album: Album) {
    router.push(`/music/${album.slug}`);
  }

  return <MusicGrid albums={ALBUMS} onOpenAlbum={openAlbum} />;
}
