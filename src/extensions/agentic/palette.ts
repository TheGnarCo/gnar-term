/**
 * Agentic-extension status palette.
 *
 * The three dashboard panels (AgentBoard, BranchLifecycleSwimlanes,
 * AttentionInbox) all render status pills with overlapping semantics
 * (awaiting / errored / success / informational / neutral). Each panel
 * used to spell out its own hex literals, which let the three diverge
 * subtly over time. This module is the single source of truth — each
 * panel maps its domain enum to one of the named keys here.
 *
 * Color intent (not the exact hex — the values may evolve):
 *   - success    — green; in-flight or healthy-positive states
 *   - attention  — yellow; needs-user states
 *   - error      — red; failures
 *   - info       — indigo; informational / terminal-positive
 *   - accent     — purple; emphasis (currently: merged)
 *   - neutral    — translucent white; idle / draft / progress
 */

export interface StatusColor {
  fg: string;
  bg: string;
}

export const palette = {
  success: { fg: "#4ade80", bg: "rgba(34, 197, 94, 0.2)" },
  attention: { fg: "#facc15", bg: "rgba(234, 179, 8, 0.2)" },
  error: { fg: "#f87171", bg: "rgba(239, 68, 68, 0.2)" },
  info: { fg: "#a5b4fc", bg: "rgba(99, 102, 241, 0.2)" },
  accent: { fg: "#c084fc", bg: "rgba(168, 85, 247, 0.2)" },
  neutral: { fg: "rgba(255, 255, 255, 0.5)", bg: "rgba(255, 255, 255, 0.1)" },
} as const satisfies Record<string, StatusColor>;

export type PaletteKey = keyof typeof palette;

/** Inline `style=…` snippet for foreground + background. */
export function pillStyle(key: PaletteKey): string {
  const c = palette[key];
  return `background: ${c.bg}; color: ${c.fg};`;
}
