"use client";

import { useState } from "react";
import { getNickname, setNickname } from "@/lib/nicknames";

export default function NicknameEditor({ wallet }: { wallet: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(() => getNickname(wallet) ?? "");
  const [saved, setSaved] = useState(() => getNickname(wallet));

  function save() {
    setNickname(wallet, value);
    setSaved(value.trim() || undefined);
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
        />
        <button onClick={save}>Save</button>
      </div>
    );
  }

  return (
    <button className="nickname-trigger" onClick={() => setEditing(true)}>
      {saved ? `Editing as ${saved}` : "Set display name"}
    </button>
  );
}
