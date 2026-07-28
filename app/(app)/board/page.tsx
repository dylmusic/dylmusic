import type { Metadata } from "next";
import BulletinBoard from "@/components/BulletinBoard";

export const metadata: Metadata = {
  title: "Community Board",
  description:
    "The Dyl community bulletin board — post a message, see what other Music NFT holders are saying.",
};

export default function BoardPage() {
  return <BulletinBoard />;
}
