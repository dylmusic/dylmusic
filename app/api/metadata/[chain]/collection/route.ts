import { NextRequest, NextResponse } from "next/server";
import { CHAINS } from "@/lib/albums";
import { ADMIN_WALLET } from "@/lib/admin";

const SITE_URL = "https://nft.dylmusic.com";

// OpenSea's contractURI() convention (not part of ERC-721 itself) — powers
// the collection-level page (banner/description), separate from any single
// item's own tokenURI. seller_fee_basis_points mirrors DylCollection.sol's
// default royalty (6.9% = 690/10000, admin-settable via setRoyalty).
export async function GET(_req: NextRequest, { params }: { params: { chain: string } }) {
  const chain = CHAINS.find((c) => c.key === params.chain);
  if (!chain) {
    return NextResponse.json({ error: "unknown chain" }, { status: 404 });
  }

  // Same reasoning as the per-tokenId route — static content, re-crawled
  // constantly by marketplaces, previously never cached at the edge at all.
  return NextResponse.json(
    {
      name: "Dyl",
      description:
        "Dyl — Music NFTs. Onchain Music. Crypto Rich. Numbered, real editions of every track, on-chain, forever.",
      image: `${SITE_URL}/brand/dyl-pfp-avatar.png`,
      external_link: SITE_URL,
      seller_fee_basis_points: 690,
      fee_recipient: ADMIN_WALLET,
    },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } }
  );
}
