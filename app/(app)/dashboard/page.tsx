"use client";

import { CRYPTO_RICH_DELUXE } from "@/lib/albums";
import MultichainOverview from "@/components/MultichainOverview";

export default function DashboardPage() {
  return <MultichainOverview album={CRYPTO_RICH_DELUXE} />;
}
