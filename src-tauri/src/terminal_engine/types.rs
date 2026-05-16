//! Phase 1 grid types for the terminal state engine.
//!
//! Serialization derives (serde) were added in cycle-3 alongside the
//! TypeScript wire format mirror (`src/lib/types/terminal-ipc.ts`).
//! `ColorIndex` uses an adjacently-tagged serde representation (`tag = "kind"`,
//! `content = "value"`) so the TypeScript side receives a clean discriminated
//! union: `{ kind: "Indexed", value: number } | { kind: "Rgb", value: [number, number, number] }`.

// ─── Attribute bitfield constants ─────────────────────────────────────────────

/// Bold text attribute bit.
pub const ATTR_BOLD: u8 = 1;
/// Underline text attribute bit.
pub const ATTR_UNDERLINE: u8 = 2;
/// Inverse (reverse video) text attribute bit.
pub const ATTR_INVERSE: u8 = 4;
/// Italic text attribute bit.
pub const ATTR_ITALIC: u8 = 8;

// ─── Color ────────────────────────────────────────────────────────────────────

/// Terminal color: either a 256-color palette index or a 24-bit RGB triplet.
///
/// Named colors (foreground / background / black / etc.) from the alacritty
/// `NamedColor` enum are mapped to their conventional palette index (0-15) when
/// building a `ColorIndex`.
///
/// # Serde representation
///
/// Uses adjacently-tagged serde (`tag = "kind"`, `content = "value"`) so the
/// on-wire JSON is a clean discriminated union:
/// - `{ "kind": "Indexed", "value": 7 }`
/// - `{ "kind": "Rgb", "value": [255, 128, 0] }`
///
/// This maps to the TypeScript type:
/// `{ kind: "Indexed"; value: number } | { kind: "Rgb"; value: [number, number, number] }`
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", content = "value")]
pub enum ColorIndex {
    /// 256-color palette index (0–255). Named colors use conventional indices
    /// 0-15; the default foreground maps to 7, default background to 0.
    Indexed(u8),
    /// 24-bit RGB truecolor.
    Rgb(u8, u8, u8),
}

// ─── Cell ─────────────────────────────────────────────────────────────────────

/// A single terminal grid cell.
///
/// `ch` is a `String` to support multi-byte grapheme clusters. `attrs` is a
/// bitfield using the `ATTR_*` constants above.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Cell {
    /// The character(s) in this cell. Space (`" "`) for empty cells.
    pub ch: String,
    /// Foreground color.
    pub fg: ColorIndex,
    /// Background color.
    pub bg: ColorIndex,
    /// Attribute bitfield (`ATTR_BOLD | ATTR_UNDERLINE | ATTR_INVERSE | ATTR_ITALIC`).
    pub attrs: u8,
}

// ─── RowData ──────────────────────────────────────────────────────────────────

/// One row of `Cell`s in the grid snapshot.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct RowData {
    /// The cells in this row, left-to-right, length == `GridSnapshot::cols`.
    pub cells: Vec<Cell>,
}

// ─── GridSnapshot ─────────────────────────────────────────────────────────────

/// A point-in-time snapshot of the full terminal grid viewport.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GridSnapshot {
    /// Viewport width in columns.
    pub cols: u16,
    /// Viewport height in rows.
    pub rows: u16,
    /// Cursor state at snapshot time.
    pub cursor: CursorPos,
    /// Row data, top to bottom, length == `rows`.
    pub rows_data: Vec<RowData>,
}

// ─── DirtyRect ────────────────────────────────────────────────────────────────

/// A dirty (changed) span within a single row.
///
/// `col_end` is exclusive: a rect covering columns 0–4 has `col_start = 0`,
/// `col_end = 5`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct DirtyRect {
    /// Zero-based viewport row index.
    pub row: u16,
    /// First dirty column (inclusive).
    pub col_start: u16,
    /// Last dirty column (exclusive).
    pub col_end: u16,
    /// The cells in the dirty span (`col_end - col_start` elements).
    pub cells: Vec<Cell>,
}

// ─── CursorPos ────────────────────────────────────────────────────────────────

/// Terminal cursor position and visibility.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct CursorPos {
    /// Zero-based viewport row.
    pub row: u16,
    /// Zero-based viewport column.
    pub col: u16,
    /// `true` when the cursor is currently visible (`SHOW_CURSOR` mode).
    pub visible: bool,
}
