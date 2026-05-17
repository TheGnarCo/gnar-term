/**
 * alacritty-renderer.test.ts
 *
 * Tests for the pure canvas-2d renderer.  Uses a MockContext that records
 * every canvas API call so we can assert the *sequence of operations* rather
 * than pixel output.
 *
 * AC-4 keywords: snapshot, diff, canvas, cursor, palette, bold, underline,
 * inverse, renderer, cells.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  Renderer,
  resolveColor,
  DEFAULT_NAMED_PALETTE,
} from "./alacritty-renderer";
import type {
  GridSnapshot,
  GridDiff,
  CursorPos,
  Cell,
} from "../types/terminal-ipc";
import {
  ATTR_BOLD,
  ATTR_UNDERLINE,
  ATTR_INVERSE,
  ATTR_ITALIC,
  ATTR_DIM,
  ATTR_HIDDEN,
  ATTR_STRIKEOUT,
} from "../types/terminal-ipc";

// ─── MockContext ───────────────────────────────────────────────────────────────

interface Call {
  method: string;
  args: unknown[];
}

/** Minimal canvas-2d mock that records every method call + property set. */
class MockContext {
  calls: Call[] = [];
  fillStyle: string = "#000000";
  font: string = "";
  textBaseline: CanvasTextBaseline = "top";

  private _record(method: string, args: unknown[]) {
    this.calls.push({ method, args });
  }

  fillRect(...args: number[]) {
    this._record("fillRect", args);
  }
  strokeRect(...args: number[]) {
    this._record("strokeRect", args);
  }
  fillText(text: string, x: number, y: number) {
    this._record("fillText", [text, x, y]);
  }
  clearRect(...args: number[]) {
    this._record("clearRect", args);
  }
  measureText(_text: string): TextMetrics {
    // Returns a fixed width of 8px for any character (matches cellWidth in tests)
    return { width: 8 } as TextMetrics;
  }

  // Property setters/getters recorded via Proxy-style overrides
  setFillStyle(v: string) {
    this._record("set fillStyle", [v]);
    this.fillStyle = v;
  }
  setFont(v: string) {
    this._record("set font", [v]);
    this.font = v;
  }

  reset() {
    this.calls = [];
    this.fillStyle = "#000000";
    this.font = "";
  }
}

// Wrap MockContext so property assignments are also recorded
function makeMockContext(): {
  ctx: CanvasRenderingContext2D;
  mock: MockContext;
} {
  const mock = new MockContext();
  const ctx = new Proxy(mock, {
    set(target, prop, value) {
      if (prop === "fillStyle") {
        target.setFillStyle(value as string);
        return true;
      }
      if (prop === "font") {
        target.setFont(value as string);
        return true;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (target as any)[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, mock };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCell(ch: string, fg = 7, bg = 0, attrs = 0): Cell {
  return {
    ch,
    fg: { kind: "Indexed", value: fg },
    bg: { kind: "Indexed", value: bg },
    attrs,
  };
}

function makeCursor(
  row: number,
  col: number,
  visible = true,
  shape: CursorPos["shape"] = { kind: "block" },
): CursorPos {
  return { row, col, visible, shape };
}

function makeSnapshot(
  cols: number,
  rows: number,
  cells?: Cell[][],
): GridSnapshot {
  const defaultCell = makeCell(" ");
  const rows_data = Array.from({ length: rows }, (_, r) => ({
    cells: Array.from(
      { length: cols },
      (_, c) => cells?.[r]?.[c] ?? defaultCell,
    ),
  }));
  return { cols, rows, cursor: makeCursor(0, 0, false), rows_data };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("Renderer (canvas-2d alacritty renderer)", () => {
  let mock: MockContext;
  let renderer: Renderer;

  beforeEach(() => {
    const result = makeMockContext();
    mock = result.mock;
    renderer = new Renderer({
      ctx: result.ctx,
      fontFamily: "monospace",
      fontSize: 14,
      cellWidth: 8,
      cellHeight: 17,
    });
  });

  // ── snapshot ──────────────────────────────────────────────────────────────

  it("paintSnapshot of a 3x2 grid emits 6 fillText calls", () => {
    const snapshot = makeSnapshot(3, 2, [
      [makeCell("a"), makeCell("b"), makeCell("c")],
      [makeCell("d"), makeCell("e"), makeCell("f")],
    ]);
    renderer.paintSnapshot(snapshot);
    const texts = mock.calls.filter((c) => c.method === "fillText");
    expect(texts).toHaveLength(6);
    const chars = texts.map((c) => c.args[0]);
    expect(chars).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("paintSnapshot with visible cursor paints cursor after cells", () => {
    const snapshot = makeSnapshot(2, 1);
    snapshot.cursor = makeCursor(0, 1, true);
    renderer.paintSnapshot(snapshot);
    const rects = mock.calls.filter((c) => c.method === "fillRect");
    // At minimum one fillRect for cursor (background fills also use fillRect,
    // but there must be at least one after all fillTexts)
    const lastFillRect = [...mock.calls]
      .reverse()
      .find((c) => c.method === "fillRect");
    const lastFillText = [...mock.calls]
      .reverse()
      .find((c) => c.method === "fillText");
    // cursor fillRect appears; we need at least one rect total
    expect(rects.length).toBeGreaterThan(0);
    // cursor rect must come after the last text: paintCursor is called at the
    // end of paintSnapshot, after all cells have been painted.
    expect(lastFillRect).toBeDefined();
    expect(lastFillText).toBeDefined();
    const cursorIdx = mock.calls.lastIndexOf(lastFillRect!);
    const textIdx = mock.calls.lastIndexOf(lastFillText!);
    expect(cursorIdx).toBeGreaterThan(textIdx);
  });

  // ── diff ──────────────────────────────────────────────────────────────────

  it("paintDiff with a single 3-cell dirty rect emits exactly 3 fillText calls", () => {
    const diff: GridDiff = {
      rows: 5,
      cols: 10,
      cursor: makeCursor(0, 0, false),
      dirty: [
        {
          row: 2,
          col_start: 1,
          col_end: 4,
          cells: [makeCell("x"), makeCell("y"), makeCell("z")],
        },
      ],
    };
    renderer.paintDiff(diff);
    const texts = mock.calls.filter((c) => c.method === "fillText");
    expect(texts).toHaveLength(3);
  });

  it("paintDiff dirty rect positions fillText at correct canvas coordinates", () => {
    const diff: GridDiff = {
      rows: 5,
      cols: 10,
      cursor: makeCursor(0, 0, false),
      dirty: [
        {
          row: 1,
          col_start: 2,
          col_end: 3,
          cells: [makeCell("Q")],
        },
      ],
    };
    renderer.paintDiff(diff);
    const text = mock.calls.find(
      (c) => c.method === "fillText" && c.args[0] === "Q",
    );
    expect(text).toBeDefined();
    // x = col_start * cellWidth = 2 * 8 = 16
    expect(text!.args[1]).toBe(16);
    // y = row * cellHeight = 1 * 17 = 17
    expect(text!.args[2]).toBe(17);
  });

  // ── cursor ────────────────────────────────────────────────────────────────

  it("cursor visible:true produces at least one fillRect (cursor paint)", () => {
    renderer.paintCursor(makeCursor(0, 0, true));
    const rects = mock.calls.filter((c) => c.method === "fillRect");
    expect(rects.length).toBeGreaterThan(0);
  });

  it("cursor visible:false produces zero canvas operations", () => {
    renderer.paintCursor(makeCursor(1, 1, false));
    expect(mock.calls).toHaveLength(0);
  });

  // ── bold ──────────────────────────────────────────────────────────────────

  it("SGR bold sets a bold font before fillText for the affected cells", () => {
    const diff: GridDiff = {
      rows: 1,
      cols: 5,
      cursor: makeCursor(0, 0, false),
      dirty: [
        {
          row: 0,
          col_start: 0,
          col_end: 1,
          cells: [makeCell("B", 7, 0, ATTR_BOLD)],
        },
      ],
    };
    renderer.paintDiff(diff);
    const fontSets = mock.calls.filter((c) => c.method === "set font");
    const boldFont = fontSets.find((c) =>
      (c.args[0] as string).includes("bold"),
    );
    expect(boldFont).toBeDefined();
    // Bold font set must come before the fillText for "B"
    const boldIdx = mock.calls.indexOf(boldFont!);
    const textIdx = mock.calls.findIndex(
      (c) => c.method === "fillText" && c.args[0] === "B",
    );
    expect(boldIdx).toBeLessThan(textIdx);
  });

  // ── underline ─────────────────────────────────────────────────────────────

  it("SGR underline emits a fillRect/strokeRect line beneath the cell", () => {
    const diff: GridDiff = {
      rows: 1,
      cols: 5,
      cursor: makeCursor(0, 0, false),
      dirty: [
        {
          row: 0,
          col_start: 0,
          col_end: 1,
          cells: [makeCell("U", 7, 0, ATTR_UNDERLINE)],
        },
      ],
    };
    renderer.paintDiff(diff);
    const rects = mock.calls.filter(
      (c) => c.method === "fillRect" || c.method === "strokeRect",
    );
    // At minimum one background fill + one underline rect
    const underlineRect = rects.find((r) => {
      // The underline rect is 1px tall (height = 1) and positioned near cell bottom
      const [, , , h] = r.args as number[];
      return h === 1;
    });
    expect(underlineRect).toBeDefined();
  });

  // ── inverse ───────────────────────────────────────────────────────────────

  it("SGR inverse swaps fillStyle between fg and bg for the affected cell", () => {
    // Default fg=7 (light gray #c0c0c0), bg=0 (black #000000)
    const diff: GridDiff = {
      rows: 1,
      cols: 5,
      cursor: makeCursor(0, 0, false),
      dirty: [
        {
          row: 0,
          col_start: 0,
          col_end: 1,
          cells: [makeCell("I", 7, 0, ATTR_INVERSE)],
        },
      ],
    };
    renderer.paintDiff(diff);
    const styleChanges = mock.calls
      .filter((c) => c.method === "set fillStyle")
      .map((c) => c.args[0] as string);
    // With inverse: bg rect gets fg color, text gets bg color (swapped)
    // So we should see a color from the normal-fg palette used for background
    const fgColor7 = "#c0c0c0"; // canonical index-7
    const bgColor0 = "#000000"; // canonical index-0
    // bg fill = fg color (swapped), text fill = bg color (swapped)
    expect(styleChanges).toContain(fgColor7);
    expect(styleChanges).toContain(bgColor0);
  });

  // ── palette ───────────────────────────────────────────────────────────────

  it("16-color palette: index 0 resolves to #000000 (black)", () => {
    const diff: GridDiff = {
      rows: 1,
      cols: 5,
      cursor: makeCursor(0, 0, false),
      dirty: [
        { row: 0, col_start: 0, col_end: 1, cells: [makeCell("X", 0, 0)] },
      ],
    };
    renderer.paintDiff(diff);
    const styleChanges = mock.calls
      .filter((c) => c.method === "set fillStyle")
      .map((c) => c.args[0] as string);
    expect(styleChanges).toContain("#000000");
  });

  it("16-color palette: index 1 resolves to #800000 (dark red)", () => {
    const diff: GridDiff = {
      rows: 1,
      cols: 5,
      cursor: makeCursor(0, 0, false),
      dirty: [
        { row: 0, col_start: 0, col_end: 1, cells: [makeCell("X", 1, 0)] },
      ],
    };
    renderer.paintDiff(diff);
    const styleChanges = mock.calls
      .filter((c) => c.method === "set fillStyle")
      .map((c) => c.args[0] as string);
    expect(styleChanges).toContain("#800000");
  });

  it("16-color palette: index 2 resolves to #008000 (dark green)", () => {
    const diff: GridDiff = {
      rows: 1,
      cols: 5,
      cursor: makeCursor(0, 0, false),
      dirty: [
        { row: 0, col_start: 0, col_end: 1, cells: [makeCell("X", 2, 0)] },
      ],
    };
    renderer.paintDiff(diff);
    const styleChanges = mock.calls
      .filter((c) => c.method === "set fillStyle")
      .map((c) => c.args[0] as string);
    expect(styleChanges).toContain("#008000");
  });

  it("16-color palette: index 4 resolves to #000080 (dark blue)", () => {
    const diff: GridDiff = {
      rows: 1,
      cols: 5,
      cursor: makeCursor(0, 0, false),
      dirty: [
        { row: 0, col_start: 0, col_end: 1, cells: [makeCell("X", 4, 0)] },
      ],
    };
    renderer.paintDiff(diff);
    const styleChanges = mock.calls
      .filter((c) => c.method === "set fillStyle")
      .map((c) => c.args[0] as string);
    expect(styleChanges).toContain("#000080");
  });

  it("16-color palette: index 9 resolves to bright red #ff0000", () => {
    const diff: GridDiff = {
      rows: 1,
      cols: 5,
      cursor: makeCursor(0, 0, false),
      dirty: [
        { row: 0, col_start: 0, col_end: 1, cells: [makeCell("X", 9, 0)] },
      ],
    };
    renderer.paintDiff(diff);
    const styleChanges = mock.calls
      .filter((c) => c.method === "set fillStyle")
      .map((c) => c.args[0] as string);
    expect(styleChanges).toContain("#ff0000");
  });

  it("16-color palette: Rgb color passed through as css string", () => {
    const diff: GridDiff = {
      rows: 1,
      cols: 5,
      cursor: makeCursor(0, 0, false),
      dirty: [
        {
          row: 0,
          col_start: 0,
          col_end: 1,
          cells: [
            {
              ch: "X",
              fg: { kind: "Rgb", value: [255, 128, 0] },
              bg: { kind: "Indexed", value: 0 },
              attrs: 0,
            },
          ],
        },
      ],
    };
    renderer.paintDiff(diff);
    const styleChanges = mock.calls
      .filter((c) => c.method === "set fillStyle")
      .map((c) => c.args[0] as string);
    expect(styleChanges).toContain("rgb(255,128,0)");
  });

  // ── cells count ───────────────────────────────────────────────────────────

  it("paintDiff with two dirty rects only repaints those cells, not the whole grid", () => {
    const diff: GridDiff = {
      rows: 10,
      cols: 80,
      cursor: makeCursor(0, 0, false),
      dirty: [
        {
          row: 0,
          col_start: 0,
          col_end: 2,
          cells: [makeCell("a"), makeCell("b")],
        },
        {
          row: 3,
          col_start: 5,
          col_end: 6,
          cells: [makeCell("c")],
        },
      ],
    };
    renderer.paintDiff(diff);
    const texts = mock.calls.filter((c) => c.method === "fillText");
    // Only the 3 dirty cells are painted — not all 800 grid cells
    expect(texts).toHaveLength(3);
  });

  // ── 256-color palette: 16-color regression guard ──────────────────────────

  it("indexed color 0-15 palette: indices 0-15 produce correct hex colors (regression guard)", () => {
    const expected = [
      "#000000", // 0 black
      "#800000", // 1 dark red
      "#008000", // 2 dark green
      "#808000", // 3 dark yellow
      "#000080", // 4 dark blue
      "#800080", // 5 dark magenta
      "#008080", // 6 dark cyan
      "#c0c0c0", // 7 light gray
      "#808080", // 8 dark gray
      "#ff0000", // 9 bright red
      "#00ff00", // 10 bright green
      "#ffff00", // 11 bright yellow
      "#0000ff", // 12 bright blue
      "#ff00ff", // 13 bright magenta
      "#00ffff", // 14 bright cyan
      "#ffffff", // 15 white
    ];
    for (let i = 0; i < 16; i++) {
      expect(resolveColor({ kind: "Indexed", value: i }), `index ${i}`).toBe(
        expected[i],
      );
    }
  });

  // ── 256-color palette cube: xterm 6x6x6 cube ─────────────────────────────

  it("indexed color cube: Indexed(16) resolves to #000000 (cube origin)", () => {
    expect(resolveColor({ kind: "Indexed", value: 16 })).toBe("#000000");
  });

  it("indexed color cube: Indexed(196) resolves to #ff0000 (cube r=5 g=0 b=0)", () => {
    // 16 + 36*5 + 6*0 + 0 = 16 + 180 = 196
    expect(resolveColor({ kind: "Indexed", value: 196 })).toBe("#ff0000");
  });

  it("indexed color cube: Indexed(231) resolves to #ffffff (cube max r=5 g=5 b=5)", () => {
    // 16 + 36*5 + 6*5 + 5 = 16 + 180 + 30 + 5 = 231
    expect(resolveColor({ kind: "Indexed", value: 231 })).toBe("#ffffff");
  });

  it("indexed color cube: Indexed(46) resolves to #00ff00 (cube r=0 g=5 b=0)", () => {
    // 16 + 36*0 + 6*5 + 0 = 16 + 30 = 46
    expect(resolveColor({ kind: "Indexed", value: 46 })).toBe("#00ff00");
  });

  // ── 256-color palette: grayscale ramp ─────────────────────────────────────

  it("indexed color grayscale: Indexed(232) resolves to #080808 (grayscale ramp start)", () => {
    expect(resolveColor({ kind: "Indexed", value: 232 })).toBe("#080808");
  });

  it("indexed color grayscale: Indexed(255) resolves to #eeeeee (grayscale ramp end)", () => {
    expect(resolveColor({ kind: "Indexed", value: 255 })).toBe("#eeeeee");
  });

  it("indexed color grayscale: Indexed(244) resolves to a known mid-gray (#808080)", () => {
    // value = 8 + 10*(244-232) = 8 + 10*12 = 128 = 0x80 → #808080
    expect(resolveColor({ kind: "Indexed", value: 244 })).toBe("#808080");
  });

  // ── italic SGR rendering ───────────────────────────────────────────────────

  it("SGR italic: no attrs produces a font string without bold or italic", () => {
    const diff: GridDiff = {
      rows: 1,
      cols: 5,
      cursor: makeCursor(0, 0, false),
      dirty: [
        {
          row: 0,
          col_start: 0,
          col_end: 1,
          cells: [makeCell("N", 7, 0, 0)],
        },
      ],
    };
    renderer.paintDiff(diff);
    const fontSets = mock.calls
      .filter((c) => c.method === "set font")
      .map((c) => c.args[0] as string);
    expect(fontSets.length).toBeGreaterThan(0);
    const fontStr = fontSets[fontSets.length - 1];
    expect(fontStr).not.toContain("bold");
    expect(fontStr).not.toContain("italic");
  });

  it("SGR italic: ATTR_ITALIC sets a font string that contains italic", () => {
    const diff: GridDiff = {
      rows: 1,
      cols: 5,
      cursor: makeCursor(0, 0, false),
      dirty: [
        {
          row: 0,
          col_start: 0,
          col_end: 1,
          cells: [makeCell("I", 7, 0, ATTR_ITALIC)],
        },
      ],
    };
    renderer.paintDiff(diff);
    const fontSets = mock.calls
      .filter((c) => c.method === "set font")
      .map((c) => c.args[0] as string);
    const italicFont = fontSets.find((f) => f.includes("italic"));
    expect(italicFont).toBeDefined();
    // italic font set must precede fillText for "I"
    const italicSetIdx = mock.calls.findIndex(
      (c) =>
        c.method === "set font" && (c.args[0] as string).includes("italic"),
    );
    const textIdx = mock.calls.findIndex(
      (c) => c.method === "fillText" && c.args[0] === "I",
    );
    expect(italicSetIdx).toBeLessThan(textIdx);
  });

  it("SGR bold+italic: ATTR_BOLD|ATTR_ITALIC sets a font string containing both bold and italic", () => {
    const diff: GridDiff = {
      rows: 1,
      cols: 5,
      cursor: makeCursor(0, 0, false),
      dirty: [
        {
          row: 0,
          col_start: 0,
          col_end: 1,
          cells: [makeCell("X", 7, 0, ATTR_BOLD | ATTR_ITALIC)],
        },
      ],
    };
    renderer.paintDiff(diff);
    const fontSets = mock.calls
      .filter((c) => c.method === "set font")
      .map((c) => c.args[0] as string);
    const boldItalicFont = fontSets.find(
      (f) => f.includes("bold") && f.includes("italic"),
    );
    expect(boldItalicFont).toBeDefined();
  });

  it("SGR bold only: ATTR_BOLD sets bold but not italic", () => {
    const diff: GridDiff = {
      rows: 1,
      cols: 5,
      cursor: makeCursor(0, 0, false),
      dirty: [
        {
          row: 0,
          col_start: 0,
          col_end: 1,
          cells: [makeCell("B", 7, 0, ATTR_BOLD)],
        },
      ],
    };
    renderer.paintDiff(diff);
    const fontSets = mock.calls
      .filter((c) => c.method === "set font")
      .map((c) => c.args[0] as string);
    const boldFont = fontSets.find((f) => f.includes("bold"));
    expect(boldFont).toBeDefined();
    expect(boldFont).not.toContain("italic");
  });

  // ── cursor shape (Phase-2 Theme 3) ────────────────────────────────────────

  it("cursor shape beam renders a thin vertical bar (fillRect with narrow width)", () => {
    renderer.paintCursor(makeCursor(0, 0, true, { kind: "beam" }));
    const rects = mock.calls.filter((c) => c.method === "fillRect");
    // Beam cursor: a narrow vertical bar, width << cellWidth (8px in tests).
    const beamRect = rects.find((r) => {
      const args = r.args as number[];
      const w = args[2] ?? 0;
      const h = args[3] ?? 0;
      // Width should be 1-2px (thin beam), height should be full cell height (17px)
      return w <= 2 && h >= 14;
    });
    expect(beamRect).toBeDefined();
  });

  it("cursor shape underline renders a 1px bar at cell bottom (fillRect with height=1)", () => {
    renderer.paintCursor(makeCursor(0, 0, true, { kind: "underline" }));
    const rects = mock.calls.filter((c) => c.method === "fillRect");
    // Underline cursor: 1px tall at the cell bottom.
    const underlineRect = rects.find((r) => {
      const [, , , h] = r.args as number[];
      return h === 1;
    });
    expect(underlineRect).toBeDefined();
  });

  it("cursor shape hollow_block uses strokeRect not fillRect for outline", () => {
    renderer.paintCursor(makeCursor(0, 0, true, { kind: "hollow_block" }));
    const strokeRects = mock.calls.filter((c) => c.method === "strokeRect");
    expect(strokeRects.length).toBeGreaterThan(0);
  });

  it("cursor shape hidden produces no canvas operations", () => {
    renderer.paintCursor(makeCursor(0, 0, false, { kind: "hidden" }));
    // visible=false already gates painting; hidden shape confirms no ops.
    expect(mock.calls).toHaveLength(0);
  });

  it("cursor shape block produces a fillRect (existing behavior preserved)", () => {
    renderer.paintCursor(makeCursor(0, 0, true, { kind: "block" }));
    const rects = mock.calls.filter((c) => c.method === "fillRect");
    expect(rects.length).toBeGreaterThan(0);
  });

  // ── attribute coverage (Phase-2 Theme 4) ──────────────────────────────────

  it("attribute dim darkens foreground color (globalAlpha set < 1 or color darkened)", () => {
    const diff: GridDiff = {
      rows: 1,
      cols: 5,
      cursor: makeCursor(0, 0, false),
      dirty: [
        {
          row: 0,
          col_start: 0,
          col_end: 1,
          cells: [makeCell("D", 15, 0, ATTR_DIM)],
        },
      ],
    };
    renderer.paintDiff(diff);
    // DIM: fg color should be set to a value that is NOT the full-bright color.
    // We check that the fillStyle for text is not the full-bright palette white #ffffff.
    // (The exact value depends on implementation — just not the original bright color.)
    const styleChanges = mock.calls
      .filter((c) => c.method === "set fillStyle")
      .map((c) => c.args[0] as string);
    // Must have had at least some color set for the text
    expect(styleChanges.length).toBeGreaterThan(0);
    // The full-bright fg (index 15 = #ffffff) must NOT be used for the glyph
    // (it should be dimmed). We find the fillStyle set just before fillText.
    const fillTextIdx = mock.calls.findIndex(
      (c) => c.method === "fillText" && c.args[0] === "D",
    );
    expect(fillTextIdx).toBeGreaterThan(-1);
    // Walk backwards from fillText to find the last "set fillStyle" before it.
    let lastFgStyle = "";
    for (let i = fillTextIdx - 1; i >= 0; i--) {
      if (mock.calls[i]?.method === "set fillStyle") {
        lastFgStyle = mock.calls[i]!.args[0] as string;
        break;
      }
    }
    // The dimmed color must differ from the full-bright palette entry for index 15.
    expect(lastFgStyle).not.toBe("#ffffff");
  });

  it("attribute hidden suppresses glyph by setting fg=bg before drawing", () => {
    // fg=15 (white #ffffff), bg=0 (black #000000). With HIDDEN, fg should = bg.
    const diff: GridDiff = {
      rows: 1,
      cols: 5,
      cursor: makeCursor(0, 0, false),
      dirty: [
        {
          row: 0,
          col_start: 0,
          col_end: 1,
          cells: [makeCell("H", 15, 0, ATTR_HIDDEN)],
        },
      ],
    };
    renderer.paintDiff(diff);
    const styleChanges = mock.calls
      .filter((c) => c.method === "set fillStyle")
      .map((c) => c.args[0] as string);
    // bg=black #000000 must appear (for background fill).
    // Then fg for text must also be #000000 (same as bg), making it invisible.
    const bgColor = "#000000";
    expect(styleChanges).toContain(bgColor);
    // Find the style set just before fillText for "H"
    const fillTextIdx = mock.calls.findIndex(
      (c) => c.method === "fillText" && c.args[0] === "H",
    );
    expect(fillTextIdx).toBeGreaterThan(-1);
    let lastFgStyle = "";
    for (let i = fillTextIdx - 1; i >= 0; i--) {
      if (mock.calls[i]?.method === "set fillStyle") {
        lastFgStyle = mock.calls[i]!.args[0] as string;
        break;
      }
    }
    expect(lastFgStyle).toBe(bgColor);
  });

  it("attribute strikeout adds a 1px fillRect through cell midline", () => {
    const diff: GridDiff = {
      rows: 1,
      cols: 5,
      cursor: makeCursor(0, 0, false),
      dirty: [
        {
          row: 0,
          col_start: 0,
          col_end: 1,
          cells: [makeCell("S", 7, 0, ATTR_STRIKEOUT)],
        },
      ],
    };
    renderer.paintDiff(diff);
    const rects = mock.calls.filter(
      (c) => c.method === "fillRect" || c.method === "strokeRect",
    );
    // Strikeout: 1px horizontal line through the cell midline.
    const strikeRect = rects.find((r) => {
      const [, , , h] = r.args as number[];
      return h === 1;
    });
    expect(strikeRect).toBeDefined();
  });

  // ── Named slot resolution (cycle-14 palette) ──────────────────────────────

  it("Named foreground resolves to DEFAULT_NAMED_PALETTE.foreground when no palette override", () => {
    // resolveColor with no palette argument uses the built-in defaults.
    const result = resolveColor({ kind: "Named", value: "foreground" });
    expect(result).toBe(DEFAULT_NAMED_PALETTE.foreground);
  });

  it("Named background resolves to DEFAULT_NAMED_PALETTE.background by default", () => {
    const result = resolveColor({ kind: "Named", value: "background" });
    expect(result).toBe(DEFAULT_NAMED_PALETTE.background);
  });

  it("Named cursor resolves to DEFAULT_NAMED_PALETTE.cursor by default", () => {
    const result = resolveColor({ kind: "Named", value: "cursor" });
    expect(result).toBe(DEFAULT_NAMED_PALETTE.cursor);
  });

  it("Named slot resolves to custom palette override when provided", () => {
    const customFg = "#d8d8d8";
    const result = resolveColor(
      { kind: "Named", value: "foreground" },
      { foreground: customFg },
    );
    expect(result).toBe(customFg);
  });

  it("Named slot falls back to default when caller palette lacks that slot", () => {
    // Provide a palette with only 'foreground'; 'background' must fall back.
    const result = resolveColor(
      { kind: "Named", value: "background" },
      { foreground: "#aabbcc" },
    );
    expect(result).toBe(DEFAULT_NAMED_PALETTE.background);
  });

  it("Renderer injected palette overrides named fg color in cell paint", () => {
    const customFg = "#abcdef";
    const { ctx, mock: localMock } = makeMockContext();
    const customRenderer = new Renderer({
      ctx,
      fontFamily: "monospace",
      fontSize: 14,
      cellWidth: 8,
      cellHeight: 17,
      palette: { foreground: customFg },
    });
    const diff: GridDiff = {
      rows: 1,
      cols: 5,
      cursor: makeCursor(0, 0, false),
      dirty: [
        {
          row: 0,
          col_start: 0,
          col_end: 1,
          cells: [
            {
              ch: "X",
              fg: { kind: "Named", value: "foreground" },
              bg: { kind: "Indexed", value: 0 },
              attrs: 0,
            },
          ],
        },
      ],
    };
    customRenderer.paintDiff(diff);
    const styleChanges = localMock.calls
      .filter((c) => c.method === "set fillStyle")
      .map((c) => c.args[0] as string);
    expect(styleChanges).toContain(customFg);
  });

  it("Renderer with no palette uses DEFAULT_NAMED_PALETTE for named fg", () => {
    // A renderer with no palette option must fall back to defaults.
    const diff: GridDiff = {
      rows: 1,
      cols: 5,
      cursor: makeCursor(0, 0, false),
      dirty: [
        {
          row: 0,
          col_start: 0,
          col_end: 1,
          cells: [
            {
              ch: "Y",
              fg: { kind: "Named", value: "foreground" },
              bg: { kind: "Named", value: "background" },
              attrs: 0,
            },
          ],
        },
      ],
    };
    renderer.paintDiff(diff);
    const styleChanges = mock.calls
      .filter((c) => c.method === "set fillStyle")
      .map((c) => c.args[0] as string);
    expect(styleChanges).toContain(DEFAULT_NAMED_PALETTE.foreground);
    expect(styleChanges).toContain(DEFAULT_NAMED_PALETTE.background);
  });

  it("all named slot keys in DEFAULT_NAMED_PALETTE resolve without falling through to undefined", () => {
    // Smoke test: every slot in the default palette must produce a non-empty string.
    const slots = Object.keys(DEFAULT_NAMED_PALETTE) as Array<
      keyof typeof DEFAULT_NAMED_PALETTE
    >;
    for (const slot of slots) {
      const result = resolveColor({ kind: "Named", value: slot });
      expect(result, `slot '${slot}'`).toBeTruthy();
      expect(result, `slot '${slot}' must be a string`).toBeTypeOf("string");
    }
  });

  it("Named dim_black resolves to expected dim palette value", () => {
    const result = resolveColor({ kind: "Named", value: "dim_black" });
    expect(result).toBe(DEFAULT_NAMED_PALETTE.dim_black);
  });

  it("Named bright_foreground resolves to expected palette value", () => {
    const result = resolveColor({ kind: "Named", value: "bright_foreground" });
    expect(result).toBe(DEFAULT_NAMED_PALETTE.bright_foreground);
  });
});
