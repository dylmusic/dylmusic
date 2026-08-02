import type { Metadata } from "next";

const TITLE = "Beats";
const DESCRIPTION = "Buy and lease beats from producers — coming soon on Dyl's onchain music platform.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: ["Music NFTs", "Web3 Music", "beats", "producers", "Onchain Music"],
  openGraph: { title: `${TITLE} | Dyl`, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: `${TITLE} | Dyl`, description: DESCRIPTION },
};

export default function BeatsPage() {
  return (
    <div className="dash-wrap">
      <div className="dash-page-head">
        <div className="dash-eyebrow">Beats</div>
        <h1>Beats</h1>
        <p className="swap-page-sub">Purchase and lease beats from producers</p>
      </div>
      <div className="admin-gate">
        <p>Coming Soon</p>
      </div>
    </div>
  );
}
