"use client";

import { useState } from "react";
import PrintAdModal from "@/components/PrintAdModal";

// The $PRINT easter egg gets its own real, shareable URL (Dylan: "$PRINT
// popup needs its own slug") instead of only being reachable by clicking
// the taskbar button — the modal now opens automatically on load here, and
// the taskbar's "Print" link (components/GlobalTaskbar.tsx) just navigates
// here like every other real nav item instead of a special-cased button
// with its own local state.
export default function PrintAdPage() {
  const [open, setOpen] = useState(true);

  return (
    <div className="dash-wrap">
      <div className="dash-page-head">
        <div className="dash-eyebrow">Print</div>
        <h1>You closed the ad.</h1>
        <p className="swap-page-sub">
          Fine, be that way. $PRINT still pays 5% rewards in real ETH on Robinhood Chain,
          powered by RWAs — no popup required.
        </p>
      </div>
      <button className="print-ad-buy" style={{ maxWidth: 280 }} onClick={() => setOpen(true)}>
        😤 SHOW ME THE AD AGAIN 😤
      </button>
      {open && <PrintAdModal onClose={() => setOpen(false)} />}
    </div>
  );
}
