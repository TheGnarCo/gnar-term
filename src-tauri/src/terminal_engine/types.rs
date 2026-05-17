//! Phase 1 grid types for the terminal state engine.
//!
//! Serialization derives (serde) were added in cycle-3 alongside the
//! TypeScript wire format mirror (`src/lib/types/terminal-ipc.ts`).
//! `ColorIndex` uses an adjacently-tagged serde representation (`tag = "kind"`,
//! `content = "value"`) so the TypeScript side receives a clean discriminated
//! union:
//! - `{ kind: "Indexed", value: number }`
//! - `{ kind: "Rgb", value: [number, number, number] }`
//! - `{ kind: "Named", value: "foreground" | "background" | ... }` (cycle-14)
//!
//! Cycle-12 additions:
//! - `CursorShapeTag` enum and `CursorPos::shape` field (Theme 3).
//! - `ATTR_DIM`, `ATTR_HIDDEN`, `ATTR_STRIKEOUT`, `ATTR_WIDE_CHAR` (Theme 4).
//!
//! Cycle-14 additions:
//! - `NamedSlot` enum — the 13 semantic color slots from `vte::ansi::NamedColor`
//!   that cannot be expressed as a palette index (Foreground=256, Background=257,
//!   Cursor=258, DimBlack..DimWhite=259..266, BrightForeground=267,
//!   DimForeground=268).
//! - `ColorIndex::Named(NamedSlot)` — third variant preserving semantic identity
//!   across the IPC wire format so OSC 10/11/12 theme overrides reach the renderer.
//!
//! # Attribute bitfield layout (cycle-12 extended, u8 — 8 bits total)
//!
//! | Bit | Constant          | Meaning                  |
//! |-----|-------------------|--------------------------|
//! |  0  | `ATTR_BOLD`       | Bold text                |
//! |  1  | `ATTR_UNDERLINE`  | Underlined text          |
//! |  2  | `ATTR_INVERSE`    | Reverse video            |
//! |  3  | `ATTR_ITALIC`     | Italic text              |
//! |  4  | `ATTR_DIM`        | Dim / half-bright text   |
//! |  5  | `ATTR_HIDDEN`     | Concealed / invisible    |
//! |  6  | `ATTR_STRIKEOUT`  | Strikethrough            |
//! |  7  | `ATTR_WIDE_CHAR`  | Wide (East Asian) glyph  |
//!
//! The `u8` ceiling (8 bits) is intentional for Phase 2. If more attributes are
//! needed in future phases, widen to `u16` and update the TS mirror accordingly.

// ─── Attribute bitfield constants ─────────────────────────────────────────────

/// Bold text attribute bit.
pub const ATTR_BOLD: u8 = 1;
/// Underline text attribute bit.
pub const ATTR_UNDERLINE: u8 = 2;
/// Inverse (reverse video) text attribute bit.
pub const ATTR_INVERSE: u8 = 4;
/// Italic text attribute bit.
pub const ATTR_ITALIC: u8 = 8;
/// Dim / half-bright text attribute bit (cycle-12).
pub const ATTR_DIM: u8 = 16;
/// Concealed / invisible text attribute bit (cycle-12).
pub const ATTR_HIDDEN: u8 = 32;
/// Strikethrough text attribute bit (cycle-12).
pub const ATTR_STRIKEOUT: u8 = 64;
/// Wide (East Asian) character attribute bit (cycle-12).
pub const ATTR_WIDE_CHAR: u8 = 128;

// ─── Color ────────────────────────────────────────────────────────────────────

/// Semantic color slots from `vte::ansi::NamedColor` that cannot be expressed
/// as a palette index (0-255) without erasing semantic identity.
///
/// These 13 slots map to the named-color range of the alacritty `Colors` array
/// (indices 256-268), which is where OSC 10/11/12 theme overrides land:
///
/// | Slot               | Index |
/// |--------------------|-------|
/// | `Foreground`       | 256   |
/// | `Background`       | 257   |
/// | `Cursor`           | 258   |
/// | `DimBlack`         | 259   |
/// | `DimRed`           | 260   |
/// | `DimGreen`         | 261   |
/// | `DimYellow`        | 262   |
/// | `DimBlue`          | 263   |
/// | `DimMagenta`       | 264   |
/// | `DimCyan`          | 265   |
/// | `DimWhite`         | 266   |
/// | `BrightForeground` | 267   |
/// | `DimForeground`    | 268   |
///
/// The 16 ANSI palette entries (`Black=0`..`BrightWhite=15`) are intentionally
/// excluded — they are interchangeable with `ColorIndex::Indexed(0..15)` and
/// collapsing them preserves backward compatibility.
///
/// # Serde
///
/// Serialised with `rename_all = "snake_case"` so on the wire:
/// `Foreground` → `"foreground"`, `BrightForeground` → `"bright_foreground"`, etc.
/// This matches the TypeScript `NamedSlot` string union in `terminal-ipc.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NamedSlot {
    /// Default foreground color (OSC 10 / SGR 39). `NamedColor` index 256.
    Foreground,
    /// Default background color (OSC 11 / SGR 49). `NamedColor` index 257.
    Background,
    /// Cursor color override (OSC 12). `NamedColor` index 258.
    Cursor,
    /// Dim black. `NamedColor` index 259.
    DimBlack,
    /// Dim red. `NamedColor` index 260.
    DimRed,
    /// Dim green. `NamedColor` index 261.
    DimGreen,
    /// Dim yellow. `NamedColor` index 262.
    DimYellow,
    /// Dim blue. `NamedColor` index 263.
    DimBlue,
    /// Dim magenta. `NamedColor` index 264.
    DimMagenta,
    /// Dim cyan. `NamedColor` index 265.
    DimCyan,
    /// Dim white. `NamedColor` index 266.
    DimWhite,
    /// Bright foreground. `NamedColor` index 267.
    BrightForeground,
    /// Dim foreground. `NamedColor` index 268.
    DimForeground,
}

/// Terminal color: a 256-color palette index, a 24-bit RGB triplet, or a
/// semantic named slot (foreground / background / cursor / dim variants).
///
/// # Serde representation
///
/// Uses adjacently-tagged serde (`tag = "kind"`, `content = "value"`) so the
/// on-wire JSON is a clean discriminated union:
/// - `{ "kind": "Indexed", "value": 7 }`
/// - `{ "kind": "Rgb", "value": [255, 128, 0] }`
/// - `{ "kind": "Named", "value": "foreground" }` (cycle-14)
///
/// This maps to the TypeScript type in `terminal-ipc.ts`:
/// ```ts
/// type ColorIndex =
///   | { kind: "Indexed"; value: number }
///   | { kind: "Rgb"; value: [number, number, number] }
///   | { kind: "Named"; value: NamedSlot };
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", content = "value")]
pub enum ColorIndex {
    /// 256-color palette index (0–255). The 16 ANSI named colors (Black=0 ..
    /// BrightWhite=15) are expressed here; they are interchangeable with the
    /// standard xterm-256 palette indices.
    Indexed(u8),
    /// 24-bit RGB truecolor.
    Rgb(u8, u8, u8),
    /// Semantic named slot — a color identity that cannot be collapsed to a
    /// palette index without erasing meaning (e.g. Foreground ≠ White=7).
    /// See `NamedSlot` for the full list.
    Named(NamedSlot),
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

// ─── CursorShapeTag ───────────────────────────────────────────────────────────

/// Cursor shape, mirroring `alacritty_terminal::vte::ansi::CursorShape`.
///
/// # Serde representation
///
/// Uses `tag = "kind"` with `rename_all = "snake_case"` so the on-wire JSON is
/// `{ "kind": "block" }`, `{ "kind": "beam" }`, etc. — matching the TypeScript
/// `CursorPos.shape` union type.
///
/// The `Hidden` variant corresponds to the cursor being invisible (i.e.
/// `SHOW_CURSOR` mode is off outside vi-mode, or the cursor style is
/// `CursorShape::Hidden`). `CursorPos::visible` is set to `false` when
/// `shape == Hidden` for backwards-compatibility with the existing renderer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CursorShapeTag {
    /// Filled block — the default cursor style.
    Block,
    /// Thin vertical bar (I-beam).
    Beam,
    /// Underscore / horizontal bar.
    Underline,
    /// Hollow block outline.
    HollowBlock,
    /// Invisible cursor.
    Hidden,
}

// ─── CursorPos ────────────────────────────────────────────────────────────────

/// Terminal cursor position, visibility, and shape.
///
/// Cycle-12 extends this with a `shape` field (see `CursorShapeTag`).
/// `visible` remains for backwards-compatibility: it equals
/// `shape != CursorShapeTag::Hidden`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct CursorPos {
    /// Zero-based viewport row.
    pub row: u16,
    /// Zero-based viewport column.
    pub col: u16,
    /// `true` when the cursor is currently visible.
    ///
    /// Equals `shape != CursorShapeTag::Hidden`. Kept for backwards-compatibility
    /// with existing renderers that test `pos.visible` without inspecting shape.
    pub visible: bool,
    /// Cursor rendering shape (cycle-12).
    pub shape: CursorShapeTag,
}
