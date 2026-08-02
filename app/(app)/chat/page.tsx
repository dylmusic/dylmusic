import type { Metadata } from "next";
import ChatPageClient from "./chat-client";

const TITLE = "Chat";
const DESCRIPTION = "Live chat for Dyl Music NFT holders — hold any edition to join the conversation.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: ["Music NFTs", "NFT holders", "Web3"],
  openGraph: { title: `${TITLE} | Dyl`, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: `${TITLE} | Dyl`, description: DESCRIPTION },
};

export default function ChatPage() {
  return <ChatPageClient />;
}
