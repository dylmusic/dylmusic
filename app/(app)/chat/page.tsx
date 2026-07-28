import type { Metadata } from "next";
import ChatPageClient from "./chat-client";

export const metadata: Metadata = {
  title: "Chat",
  description: "Live chat for Dyl Music NFT holders — hold any edition to join the conversation.",
};

export default function ChatPage() {
  return <ChatPageClient />;
}
