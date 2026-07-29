import type { Metadata } from "next";
import PrintAdPageClient from "./print-client";

const TITLE = "Print";
const DESCRIPTION = "A little easter egg — $PRINT pays 5% rewards in real ETH on Robinhood Chain.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: `${TITLE} | Dyl`, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: `${TITLE} | Dyl`, description: DESCRIPTION },
};

export default function PrintAdPage() {
  return <PrintAdPageClient />;
}
