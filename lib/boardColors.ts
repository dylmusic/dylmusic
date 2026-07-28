// Shared between the client composer (color picker) and the server route
// (validating an incoming color before it ever reaches an inline style) —
// kept out of lib/boardStore.ts on purpose so the client bundle doesn't
// need to pull in that file's @upstash/redis import just for these
// constants.
//
// Deliberately just the 3 chain colors from lib/albums.ts CHAINS (not a
// separate palette) — a note's color reads as "which chain this poster is
// repping," not an arbitrary decoration. Kept as plain string literals
// here rather than imported from albums.ts to avoid pulling client-only
// album/track data into the server route's bundle for 3 hex codes.
export const NOTE_COLORS = ["#CCFF00", "#0052FF", "#9945FF"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];
export const DEFAULT_NOTE_COLOR: NoteColor = NOTE_COLORS[0];

export function isNoteColor(v: unknown): v is NoteColor {
  return typeof v === "string" && (NOTE_COLORS as readonly string[]).includes(v);
}
