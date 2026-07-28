// Shared between the client composer (color picker) and the server route
// (validating an incoming color before it ever reaches an inline style) —
// kept out of lib/boardStore.ts on purpose so the client bundle doesn't
// need to pull in that file's @upstash/redis import just for these
// constants.

export const NOTE_COLORS = ["#f4e04d", "#ff9ecb", "#7CFF6B", "#6ec8ff", "#ffb454", "#c792ea"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];
export const DEFAULT_NOTE_COLOR: NoteColor = NOTE_COLORS[0];

export function isNoteColor(v: unknown): v is NoteColor {
  return typeof v === "string" && (NOTE_COLORS as readonly string[]).includes(v);
}
