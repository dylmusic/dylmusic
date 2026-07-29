import type { Metadata } from "next";
import BulletinBoard from "@/components/BulletinBoard";

const TITLE = "Community Board";
const DESCRIPTION =
  "The Dyl community bulletin board — post a message, see what other Music NFT holders are saying.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: `${TITLE} | Dyl`, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: `${TITLE} | Dyl`, description: DESCRIPTION },
};

export default function BoardPage() {
  return <BulletinBoard />;
}
