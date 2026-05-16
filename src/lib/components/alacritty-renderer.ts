/**
 * alacritty-renderer.ts — pure canvas-2d drawing logic for the Alacritty
 * terminal engine.
 *
 * No DOM globals are accessed at module level (only inside method bodies via
 * the injected `ctx`), making this module unit-testable with a mock context.
 *
 * Usage:
 *   const renderer = new Renderer({ ctx, fontFamily, fontSize, cellWidth, cellHeight });
 *   renderer.paintSnapshot(snapshot);   // full repaint on attach
 *   renderer.paintDiff(diff);           // partial repaint on update
 *   renderer.paintCursor(cursorPos);    // draw or erase cursor
 */

import type {
  GridSnapshot,
  GridDiff,
  CursorPos,
  Cell,
  ColorIndex,
} from "../types/terminal-ipc";
import {
  ATTR_BOLD,
  ATTR_ITALIC,
  ATTR_UNDERLINE,
  ATTR_INVERSE,
} from "../types/terminal-ipc";

// ─── Default 16-color ANSI palette ────────────────────────────────────────────
//
// Canonical CGA / VGA 16-color table.  Index layout:
//   0 = black         8  = bright black  (dark gray)
//   1 = dark red      9  = bright red
//   2 = dark green    10 = bright green
//   3 = dark yellow   11 = bright yellow
//   4 = dark blue     12 = bright blue
//   5 = dark magenta  13 = bright magenta
//   6 = dark cyan     14 = bright cyan
//   7 = light gray    15 = white
//
// RGB values follow the widely-used xterm-256 baseline that most terminal
// emulators agree on for indices 0–15.

const ANSI_PALETTE_16: readonly string[] = [
  "#000000", // 0  black
  "#800000", // 1  dark red
  "#008000", // 2  dark green
  "#808000", // 3  dark yellow (olive)
  "#000080", // 4  dark blue
  "#800080", // 5  dark magenta
  "#008080", // 6  dark cyan
  "#c0c0c0", // 7  light gray
  "#808080", // 8  dark gray (bright black)
  "#ff0000", // 9  bright red
  "#00ff00", // 10 bright green
  "#ffff00", // 11 bright yellow
  "#0000ff", // 12 bright blue
  "#ff00ff", // 13 bright magenta
  "#00ffff", // 14 bright cyan
  "#ffffff", // 15 white
];

// ─── Color resolver ───────────────────────────────────────────────────────────

// xterm 256-color cube channel value table.
// The 6 levels (0–5) map to: 0→0, 1→95, 2→135, 3→175, 4→215, 5→255.
const CUBE_CHANNEL = [0, 95, 135, 175, 215, 255] as const;

/**
 * Convert an integer 0–255 to a two-digit lowercase hex string.
 * e.g. 0 → "00", 128 → "80", 255 → "ff".
 */
function hex2(n: number): string {
  return n.toString(16).padStart(2, "0");
}

/**
 * Resolve a `ColorIndex` to a CSS color string.
 *
 * - `Indexed(0..15)` → canonical ANSI palette entry (`ANSI_PALETTE_16`).
 * - `Indexed(16..231)` → xterm 6×6×6 RGB cube.
 *   Index = 16 + 36·r + 6·g + b, where r, g, b ∈ {0..5}.
 *   Channel values: 0→0, 1→95, 2→135, 3→175, 4→215, 5→255.
 * - `Indexed(232..255)` → 24-step grayscale ramp.
 *   value = 8 + 10·(i − 232), from #080808 to #eeeeee.
 * - `Rgb(r,g,b)` → `"rgb(r,g,b)"` (direct pass-through).
 */
function resolveColor(color: ColorIndex): string {
  if (color.kind === "Rgb") {
    const [r, g, b] = color.value;
    return `rgb(${r},${g},${b})`;
  }
  // Indexed
  const idx = color.value;
  if (idx < 16) return ANSI_PALETTE_16[idx] ?? "#ffffff";
  if (idx < 232) {
    // 6×6×6 RGB cube: indices 16–231
    // The three channel indices are always in [0,5] given idx in [16,231],
    // so CUBE_CHANNEL lookups cannot be undefined — assert to satisfy TS.
    const i = idx - 16;
    const r = CUBE_CHANNEL[Math.floor(i / 36)] ?? 0;
    const g = CUBE_CHANNEL[Math.floor((i % 36) / 6)] ?? 0;
    const b = CUBE_CHANNEL[i % 6] ?? 0;
    return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  }
  // Grayscale ramp: indices 232–255 → value = 8 + 10*(i-232)
  const gray = 8 + 10 * (idx - 232);
  return `#${hex2(gray)}${hex2(gray)}${hex2(gray)}`;
}

// ─── Renderer options ─────────────────────────────────────────────────────────

export interface RendererOptions {
  ctx: CanvasRenderingContext2D;
  fontFamily: string;
  fontSize: number;
  /**
   * Cell width in pixels. Typically `ctx.measureText('M').width` measured
   * after setting the font — pass the pre-measured value so the constructor
   * doesn't need a live canvas.
   */
  cellWidth: number;
  /**
   * Cell height in pixels. Typically `fontSize * 1.2`.
   */
  cellHeight: number;
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly fontFamily: string;
  private readonly fontSize: number;
  private readonly cellWidth: number;
  private readonly cellHeight: number;

  /** Normal (non-bold, non-italic) font string, rebuilt on construction. */
  private readonly normalFont: string;
  /** Bold font string. */
  private readonly boldFont: string;
  /** Italic font string. */
  private readonly italicFont: string;
  /** Bold + italic font string. */
  private readonly boldItalicFont: string;

  constructor(opts: RendererOptions) {
    this.ctx = opts.ctx;
    this.fontFamily = opts.fontFamily;
    this.fontSize = opts.fontSize;
    this.cellWidth = opts.cellWidth;
    this.cellHeight = opts.cellHeight;
    this.normalFont = `${opts.fontSize}px ${opts.fontFamily}`;
    this.boldFont = `bold ${opts.fontSize}px ${opts.fontFamily}`;
    this.italicFont = `italic ${opts.fontSize}px ${opts.fontFamily}`;
    this.boldItalicFont = `italic bold ${opts.fontSize}px ${opts.fontFamily}`;
    // Set textBaseline to "top" so fillText y-coordinates align to the cell
    // top edge (row * cellHeight). The canvas default is "alphabetic" baseline,
    // which offsets glyphs upward by the font's ascender height and misaligns
    // them relative to background fillRects that start at row * cellHeight.
    this.ctx.textBaseline = "top";
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Full grid repaint.  Called once when a new snapshot arrives on pane attach.
   * After painting all cells, paints the cursor if visible.
   */
  paintSnapshot(snapshot: GridSnapshot): void {
    for (let row = 0; row < snapshot.rows; row++) {
      const rowData = snapshot.rows_data[row];
      if (!rowData) continue;
      for (let col = 0; col < snapshot.cols; col++) {
        const cell = rowData.cells[col];
        if (!cell) continue;
        this._paintCell(cell, row, col);
      }
    }
    this.paintCursor(snapshot.cursor);
  }

  /**
   * Partial repaint.  Only repaints the dirty cells specified in the diff.
   * The whole grid is NOT repainted — only `DirtyRect` spans are touched.
   * After painting dirty cells, paints the cursor if visible.
   */
  paintDiff(diff: GridDiff): void {
    for (const rect of diff.dirty) {
      const count = rect.col_end - rect.col_start;
      for (let i = 0; i < count; i++) {
        const cell = rect.cells[i];
        if (!cell) continue;
        this._paintCell(cell, rect.row, rect.col_start + i);
      }
    }
    this.paintCursor(diff.cursor);
  }

  /**
   * Block cursor: filled rect at `pos` in the foreground color (default
   * white). Only renders when `pos.visible === true`.
   */
  paintCursor(pos: CursorPos): void {
    if (!pos.visible) return;
    const x = pos.col * this.cellWidth;
    const y = pos.row * this.cellHeight;
    this.ctx.fillStyle = "#ffffff";
    this.ctx.fillRect(x, y, this.cellWidth, this.cellHeight);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Paint a single terminal cell at grid position `(row, col)`.
   *
   * Rendering order:
   *   1. Background fill (full cell rect).
   *   2. Text glyph (with font/color adjusted for attrs).
   *   3. Underline line (1px fillRect at cell baseline) if ATTR_UNDERLINE.
   */
  private _paintCell(cell: Cell, row: number, col: number): void {
    const x = col * this.cellWidth;
    const y = row * this.cellHeight;

    // Resolve base colors, then swap if ATTR_INVERSE
    let fgColor = resolveColor(cell.fg);
    let bgColor = resolveColor(cell.bg);
    if (cell.attrs & ATTR_INVERSE) {
      [fgColor, bgColor] = [bgColor, fgColor];
    }

    // 1. Background fill
    this.ctx.fillStyle = bgColor;
    this.ctx.fillRect(x, y, this.cellWidth, this.cellHeight);

    // 2. Font — select variant based on bold/italic attrs
    const isBold = !!(cell.attrs & ATTR_BOLD);
    const isItalic = !!(cell.attrs & ATTR_ITALIC);
    if (isBold && isItalic) {
      this.ctx.font = this.boldItalicFont;
    } else if (isBold) {
      this.ctx.font = this.boldFont;
    } else if (isItalic) {
      this.ctx.font = this.italicFont;
    } else {
      this.ctx.font = this.normalFont;
    }

    // 3. Glyph
    this.ctx.fillStyle = fgColor;
    this.ctx.fillText(cell.ch, x, y);

    // 4. Underline (1px rect at the cell baseline)
    if (cell.attrs & ATTR_UNDERLINE) {
      // Underline sits at (fontSize - 1) from the cell top, i.e. just below
      // the descender for most monospace fonts.
      const underlineY = y + this.fontSize - 1;
      this.ctx.fillStyle = fgColor;
      this.ctx.fillRect(x, underlineY, this.cellWidth, 1);
    }
  }
}

// ─── Re-export color helpers for testability ──────────────────────────────────

export { resolveColor, ANSI_PALETTE_16 };
