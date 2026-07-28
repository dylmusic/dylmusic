import type { Metadata } from "next";
import PrintAdPageClient from "./print-client";

export const metadata: Metadata = {
  title: "Print",
  description: "A little easter egg — $PRINT pays 5% rewards in real ETH on Robinhood Chain.",
};

export default function PrintAdPage() {
  return <PrintAdPageClient />;
}
