/** Shared style helpers for claude-settings section components. */

type ThemeColors = { fg: string; bg: string; border: string };

/**
 * Inline style string for text inputs in settings sections.
 *
 * @param theme - Subset of the active theme used for colors.
 * @param extra - Additional CSS declarations to append (e.g. `"width: 140px;"`).
 * @param fontSize - Font size in px (default `12`). HooksSection uses `11`.
 */
export const inputStyle =
  (theme: ThemeColors, fontSize = 12) =>
  (extra = ""): string =>
    `background: ${theme.bg}; color: ${theme.fg}; border: 1px solid ${theme.border}; border-radius: 4px; padding: 3px 8px; font-size: ${fontSize}px; font-family: monospace; ${extra}`;
