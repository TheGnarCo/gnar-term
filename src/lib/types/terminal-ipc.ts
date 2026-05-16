/**
 * Terminal IPC wire-format types — TypeScript mirror of:
 *   src-tauri/src/terminal_engine/types.rs
 *   src-tauri/src/terminal_engine/ipc.rs
 *
 * WARNING: These types must stay in sync with the Rust definitions above.
 * Any change to the Rust serde field names or enum variants requires a
 * matching update here.
 *
 * # attrs bitfield layout (used in Cell.attrs)
 *
 * | Bit | Constant         | Meaning              |
 * |-----|------------------|----------------------|
 * |  0  | ATTR_BOLD        | Bold text            |
 * |  1  | ATTR_UNDERLINE   | Underlined text      |
 * |  2  | ATTR_INVERSE     | Reverse video        |
 * |  3  | ATTR_ITALIC      | Italic text          |
 */

// ─── Attribute bitfield constants ─────────────────────────────────────────────

/** Bold text attribute bit. */
export const ATTR_BOLD = 1 as const;
/** Underline text attribute bit. */
export const ATTR_UNDERLINE = 2 as const;
/** Inverse (reverse video) text attribute bit. */
export const ATTR_INVERSE = 4 as const;
/** Italic text attribute bit. */
export const ATTR_ITALIC = 8 as const;

// ─── Color ────────────────────────────────────────────────────────────────────

/**
 * Terminal color discriminated union mirroring the Rust `ColorIndex` enum.
 *
 * The Rust serde adjacently-tagged representation (`tag = "kind"`,
 * `content = "value"`) produces:
 * - `{ "kind": "Indexed", "value": 7 }`
 * - `{ "kind": "Rgb", "value": [255, 128, 0] }`
 */
export type ColorIndex =
  | { kind: "Indexed"; value: number }
  | { kind: "Rgb"; value: [number, number, number] };

// ─── Cell ─────────────────────────────────────────────────────────────────────

/**
 * A single terminal grid cell.
 *
 * `ch` is a string (not a single character) to support multi-byte grapheme
 * clusters. Empty cells use `" "` (a single space).
 *
 * `attrs` is a bitfield; test with `attrs & ATTR_BOLD`, etc.
 */
export interface Cell {
  /** The character(s) in this cell. Space (`" "`) for empty cells. */
  ch: string;
  /** Foreground color. */
  fg: ColorIndex;
  /** Background color. */
  bg: ColorIndex;
  /** Attribute bitfield (`ATTR_BOLD | ATTR_UNDERLINE | ATTR_INVERSE | ATTR_ITALIC`). */
  attrs: number;
}

// ─── RowData ──────────────────────────────────────────────────────────────────

/**
 * One row of cells in the grid snapshot.
 * `cells.length === GridSnapshot.cols`.
 */
export interface RowData {
  /** The cells in this row, left-to-right. */
  cells: Cell[];
}

// ─── CursorPos ────────────────────────────────────────────────────────────────

/** Terminal cursor position and visibility. */
export interface CursorPos {
  /** Zero-based viewport row. */
  row: number;
  /** Zero-based viewport column. */
  col: number;
  /** `true` when the cursor is currently visible (`SHOW_CURSOR` mode). */
  visible: boolean;
}

// ─── DirtyRect ────────────────────────────────────────────────────────────────

/**
 * A dirty (changed) span within a single row.
 *
 * `col_end` is **exclusive**: a rect covering columns 0–4 has
 * `col_start = 0, col_end = 5`. The cell count is always `col_end - col_start`.
 */
export interface DirtyRect {
  /** Zero-based viewport row index. */
  row: number;
  /** First dirty column (inclusive). */
  col_start: number;
  /** Last dirty column (exclusive). */
  col_end: number;
  /** The cells in the dirty span (`col_end - col_start` elements), left-to-right. */
  cells: Cell[];
}

// ─── GridSnapshot ─────────────────────────────────────────────────────────────

/**
 * A point-in-time snapshot of the full terminal grid viewport.
 *
 * Sent once on pane attach. `rows_data` rows are ordered top-down
 * (index 0 = top row).
 */
export interface GridSnapshot {
  /** Viewport width in columns. */
  cols: number;
  /** Viewport height in rows. */
  rows: number;
  /** Cursor state at snapshot time. */
  cursor: CursorPos;
  /** Row data, top to bottom, `rows_data.length === rows`. */
  rows_data: RowData[];
}

// ─── GridDiff ─────────────────────────────────────────────────────────────────

/**
 * Per-update wire payload carrying only the cells that changed since the last
 * snapshot or diff.
 *
 * `rows` and `cols` are repeated so the renderer can detect a resize even when
 * no cells are dirty. If `rows`/`cols` differ from the last-seen values, discard
 * the current grid and request a fresh snapshot.
 *
 * `dirty` may be empty when only a resize or cursor move occurred.
 * Rects are ordered top-down by row; within a row, left-to-right by `col_start`.
 */
export interface GridDiff {
  /** Viewport height in rows at the time of this diff. */
  rows: number;
  /** Viewport width in columns at the time of this diff. */
  cols: number;
  /** Dirty spans since the last snapshot or diff. */
  dirty: DirtyRect[];
  /** Cursor position after processing the writes that produced this diff. */
  cursor: CursorPos;
}

// ─── Channel message union ────────────────────────────────────────────────────

/**
 * The tagged stream payload type for the Tauri terminal channel.
 *
 * The renderer subscribes to a Tauri `Channel` that delivers this union:
 * - First message on pane attach: `{ kind: "snapshot", value: GridSnapshot }`
 * - Subsequent messages on engine writes: `{ kind: "diff", value: GridDiff }`
 *
 * Types only — runtime channel wiring is handled in cycle-4/5.
 */
export type TerminalChannelMessage =
  | { kind: "snapshot"; value: GridSnapshot }
  | { kind: "diff"; value: GridDiff };
