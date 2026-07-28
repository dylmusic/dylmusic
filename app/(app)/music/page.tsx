"use client";

import { useRouter } from "next/navigation";
import { ALBUMS, Album } from "@/lib/albums";
import { useAppShell } from "@/components/AppShellContext";
import MusicGrid from "@/components/MusicGrid";

export default function MusicPage() {
  const router = useRouter();
  const { chain, walletAddress } = useAppShell();

  function openAlbum(album: Album) {
    router.push(`/music/${album.slug}`);
  }

  return <MusicGrid albums={ALBUMS} chain={chain} walletAddress={walletAddress} onOpenAlbum={openAlbum} />;
}
