/**
 * Shared dialog utilities — styles, browse helper, common patterns.
 */
import type { ThemeDef } from "./theme-data";

/** Build reactive style strings for dialog form elements */
export function dialogStyles(theme: ThemeDef) {
  return {
    label: `font-size: 12px; color: ${theme.fgMuted};`,
    input: `
      padding: 10px 14px; background: ${theme.bg}; border: 1px solid ${theme.border};
      border-radius: 8px; color: ${theme.fg}; font-size: 14px;
      outline: none; font-family: inherit; width: 100%; box-sizing: border-box;
    `,
    inputFocus: `border-color: ${theme.borderActive};`,
    select: `
      padding: 10px 14px; background: ${theme.bg}; border: 1px solid ${theme.border};
      border-radius: 8px; color: ${theme.fg}; font-size: 14px;
      outline: none; font-family: inherit; width: 100%; box-sizing: border-box;
      appearance: auto;
    `,
    tab: (active: boolean) => `
      padding: 6px 16px; font-size: 13px; cursor: pointer; border: none;
      border-bottom: 2px solid ${active ? theme.accent : "transparent"};
      background: none; color: ${active ? theme.fg : theme.fgDim};
      font-weight: ${active ? "600" : "400"};
    `,
    browseBtn: `
      padding: 8px 12px; border-radius: 8px; border: 1px solid ${theme.border};
      background: none; color: ${theme.fgMuted}; cursor: pointer; font-size: 13px;
      white-space: nowrap; flex-shrink: 0;
    `,
  };
}

/** Open a native directory picker and return the selected path, or null */
export async function browseDirectory(title: string): Promise<string | null> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ directory: true, multiple: false, title });
    if (selected) {
      return typeof selected === "string" ? selected : selected[0] || null;
    }
  } catch {}
  return null;
}
