"use client";

import { useState } from "react";
import { getNickname, setNickname } from "@/lib/nicknames";

export default function NicknameEditor({ wallet }: { wallet: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(() => getNickname(wallet) ?? "");

  function save() {
    setNickname(wallet, value);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="nickname-editor">
        <input
          autoFocus
          maxLength={24}
          placeholder="Display name"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
          onBlur={save}
        />
      </div>
    );
  }

  return (
    <button
      className="nickname-pencil"
      onClick={() => setEditing(true)}
      title="Set display name"
      aria-label="Set display name"
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
        <path
          d="M11.5 1.5a1.6 1.6 0 0 1 2.26 2.26L4.5 13H2v-2.5L11.5 1.5Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
