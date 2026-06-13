/**
 * Terminal font-size controls.
 *
 * Owns the supported font-size range, the current-size accessor, and the
 * apply/adjust/reset operations that re-fit every open terminal and persist the
 * choice to config.
 */
import { get } from "svelte/store";
import { workspaces } from "../stores/workspace";
import { getAllSurfaces, isTerminalSurface } from "../types";
import { getConfig, saveConfig } from "../config";

export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 32;
export const FONT_SIZE_DEFAULT = 14;

/** Current terminal font size, clamped to the supported range. */
export function getFontSize(): number {
  const n = getConfig().fontSize ?? FONT_SIZE_DEFAULT;
  return Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, n));
}

function applyFontSize(next: number): void {
  for (const ws of get(workspaces)) {
    for (const s of getAllSurfaces(ws)) {
      if (!isTerminalSurface(s)) continue;
      s.terminal.options.fontSize = next;
      try {
        s.fitAddon.fit();
      } catch {
        // fit() can throw if the terminal isn't attached to the DOM yet —
        // the size is reapplied on the next real fit, so ignore.
      }
    }
  }
}

/**
 * Adjust the terminal font size by `delta` px, clamped to
 * [FONT_SIZE_MIN, FONT_SIZE_MAX]. Persists to config and re-fits every open
 * terminal so the change is immediate and survives restart.
 */
export function adjustFontSize(delta: number): void {
  const current = getFontSize();
  const next = Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, current + delta));
  if (next === current) return;
  void saveConfig({ fontSize: next });
  applyFontSize(next);
}

/** Reset the terminal font size to the default. */
export function resetFontSize(): void {
  if (getFontSize() === FONT_SIZE_DEFAULT) return;
  void saveConfig({ fontSize: FONT_SIZE_DEFAULT });
  applyFontSize(FONT_SIZE_DEFAULT);
}
