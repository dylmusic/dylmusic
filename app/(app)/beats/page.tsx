import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Beats",
  description: "Buy and lease beats from producers — coming soon on Dyl's onchain music platform.",
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
