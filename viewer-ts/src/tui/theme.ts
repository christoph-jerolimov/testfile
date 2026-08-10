// The one place look-and-feel constants live, so every table and page
// renders statuses the same way.
import type { Status } from "../runrecord.js";

export const STATUS_GLYPH: Record<string, { glyph: string; color?: string }> = {
  passed: { glyph: "✔", color: "green" },
  failed: { glyph: "✘", color: "red" },
  aborted: { glyph: "■", color: "magenta" },
  skipped: { glyph: "↷", color: "gray" },
  pending: { glyph: "·", color: "gray" },
  running: { glyph: "▶", color: "yellow" },
};

export function statusGlyph(status: Status | string): { glyph: string; color?: string } {
  return STATUS_GLYPH[status] ?? { glyph: "?", color: "gray" };
}

// Below this width the side-by-side layouts stop working; pages show one
// panel and push the other as its own page instead.
export const NARROW_COLUMNS = 80;
