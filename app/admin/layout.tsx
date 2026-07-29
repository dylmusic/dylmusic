import type { Metadata } from "next";

// admin/page.tsx is a client component, which cannot export metadata
// directly — this layout is the only way to keep the internal admin
// panel out of search results and social unfurls (it has no real
// content worth indexing or sharing, and shouldn't get its own OG image).
export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
