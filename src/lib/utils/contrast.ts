/**
 * Pick a legible foreground color against an arbitrary hex background.
 *
 * Uses the standard relative-luminance heuristic (ITU-R BT.601
 * coefficients) and picks black above a 0.55 threshold, white below.
 * Returns "#fff" for malformed input — the call sites paint labels
 * over user-chosen colors where a missing value is an upstream bug,
 * not something to crash on.
 */
export function contrastColor(hex: string): string {
  const clean = hex.replace(/^#/, "");
  if (clean.length !== 6) return "#fff";
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? "#000" : "#fff";
}
