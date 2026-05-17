/**
 * theme-bridge.ts — Subscribes to the Svelte `theme` store and maps
 * ThemeDef values into the renderer's Palette shape, then notifies the
 * canvas-2d renderer on every theme change.
 *
 * cycle-21 wires this by calling `attachThemeBridge` inside
 * `AlacrittyTerminalSurface.svelte` and passing the renderer's
 * `setPalette` + `requestRender` callbacks.
 */

import { theme } from "../../stores/theme";
import type { NamedSlot } from "../../types/terminal-ipc";

// ─── Palette type ──────────────────────────────────────────────────────────────

/**
 * Palette used by the canvas-2d renderer.
 *
 * Maps each `NamedSlot` string key to a CSS color string.  cycle-21 passes
 * this directly to `Renderer.setPalette()`.
 */
export type Palette = Partial<Record<NamedSlot, string>>;

// ─── Public surface ────────────────────────────────────────────────────────────

export interface ThemeBridgeOptions {
  /**
   * Called with the freshly-mapped Palette whenever the theme store changes.
   * Invoked before `onRenderRequested`.
   */
  onPaletteChanged: (palette: Palette) => void;
  /**
   * Called immediately after `onPaletteChanged` to trigger a repaint.
   * Allows the caller to batch the palette update with the render request.
   */
  onRenderRequested: () => void;
}

export interface ThemeBridgeHandle {
  /** Tear down the store subscription. */
  detach: () => void;
}

/**
 * Attach a reactive bridge from the `theme` store to the renderer palette.
 *
 * Fires once synchronously on attach (store subscription fires immediately)
 * so the renderer always starts with the current palette.
 */
export function attachThemeBridge(opts: ThemeBridgeOptions): ThemeBridgeHandle {
  const unsubscribe = theme.subscribe((themeDef) => {
    const palette = mapThemeToPalette(themeDef);
    opts.onPaletteChanged(palette);
    opts.onRenderRequested();
  });

  return { detach: unsubscribe };
}

// ─── Mapping helper ────────────────────────────────────────────────────────────

/**
 * Map a `ThemeDef` to the `Palette` shape the renderer expects.
 *
 * The ThemeDef `ansi` block provides the 8 standard + 8 bright colours; the
 * terminal-specific fields provide foreground / background / cursor.
 * Dim variants are approximated at 60% brightness (matching the renderer's
 * ATTR_DIM factor) using the same hex-channel approach as `alacritty-renderer.ts`.
 */
export function mapThemeToPalette(themeDef: {
  termFg: string;
  termBg: string;
  termCursor: string;
  ansi: {
    black: string;
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
    white: string;
    brightBlack: string;
    brightRed: string;
    brightGreen: string;
    brightYellow: string;
    brightBlue: string;
    brightMagenta: string;
    brightCyan: string;
    brightWhite: string;
  };
}): Palette {
  const { ansi } = themeDef;

  return {
    foreground: themeDef.termFg,
    background: themeDef.termBg,
    cursor: themeDef.termCursor,
    bright_foreground: themeDef.termFg,
    dim_foreground: dimHex(themeDef.termFg),
    dim_black: dimHex(ansi.black),
    dim_red: dimHex(ansi.red),
    dim_green: dimHex(ansi.green),
    dim_yellow: dimHex(ansi.yellow),
    dim_blue: dimHex(ansi.blue),
    dim_magenta: dimHex(ansi.magenta),
    dim_cyan: dimHex(ansi.cyan),
    dim_white: dimHex(ansi.white),
  };
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Scale a `#rrggbb` hex color to ~60% brightness (dim variant).
 * Mirrors the 0.6 factor used by the renderer for ATTR_DIM cells.
 */
function dimHex(hex: string): string {
  if (!hex.startsWith("#") || hex.length !== 7) return hex;
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * 0.6);
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * 0.6);
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * 0.6);
  return `#${h2(r)}${h2(g)}${h2(b)}`;
}

function h2(n: number): string {
  return Math.min(255, Math.max(0, n)).toString(16).padStart(2, "0");
}
