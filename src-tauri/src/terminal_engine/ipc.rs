//! Terminal IPC wire-format types.
//!
//! # Protocol overview
//!
//! The renderer subscribes to a Tauri [`Channel`] that delivers a tagged
//! stream of [`TerminalChannelMessage`]-shaped payloads:
//!
//! 1. On **pane attach**: one `{ kind: "snapshot", value: GridSnapshot }` message
//!    carrying the full viewport grid.
//! 2. On every subsequent **engine write** (PTY bytes fed + damage collected):
//!    one or more `{ kind: "diff", value: GridDiff }` messages carrying only
//!    the dirty spans.
//!
//! # Ordering invariants
//!
//! - `GridSnapshot::rows_data` rows are ordered **top-down** (index 0 = top row).
//! - `DirtyRect::cells` are ordered **left-to-right** (index 0 = leftmost column).
//! - `DirtyRect::col_end` is **exclusive**: a rect touching columns 0–4 has
//!   `col_start = 0, col_end = 5`.  The cell count is always `col_end - col_start`.
//! - `Cell::ch` is a `String` (not `char`) to support multi-byte grapheme clusters.
//!   Empty cells use `" "` (a single space).
//!
//! # `ColorIndex` representation
//!
//! See [`crate::terminal_engine::types::ColorIndex`]. The serde adjacently-tagged
//! representation (`tag = "kind"`, `content = "value"`) produces:
//! - `{ "kind": "Indexed", "value": 7 }`
//! - `{ "kind": "Rgb", "value": [255, 128, 0] }`
//!
//! # `attrs` bitfield layout
//!
//! | Bit | Constant         | Meaning              |
//! |-----|------------------|----------------------|
//! | 0   | `ATTR_BOLD`      | Bold text            |
//! | 1   | `ATTR_UNDERLINE` | Underlined text      |
//! | 2   | `ATTR_INVERSE`   | Reverse video        |
//! | 3   | `ATTR_ITALIC`    | Italic text          |

// Re-export the types that consumers need when subscribing to the channel.
pub use super::types::{
    Cell, ColorIndex, CursorPos, DirtyRect, GridSnapshot, RowData, ATTR_BOLD, ATTR_INVERSE,
    ATTR_ITALIC, ATTR_UNDERLINE,
};

/// Per-update wire payload carrying only the cells that changed since the last
/// snapshot or diff.
///
/// `rows` and `cols` are repeated from the snapshot so the renderer can detect
/// a **resize** even when no cells are dirty (e.g. a blank-row insertion after
/// an `\x1b[2J` clear on a larger terminal).  When `rows`/`cols` differ from
/// the values seen in the last snapshot or diff, the renderer must discard its
/// current grid and request a fresh snapshot.
///
/// # Wire format (JSON)
///
/// ```json
/// {
///   "rows": 24,
///   "cols": 80,
///   "dirty": [
///     {
///       "row": 5,
///       "col_start": 10,
///       "col_end": 15,
///       "cells": [ ... ]
///     }
///   ],
///   "cursor": { "row": 5, "col": 15, "visible": true }
/// }
/// ```
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GridDiff {
    /// Viewport height in rows at the time of this diff.
    pub rows: u16,
    /// Viewport width in columns at the time of this diff.
    pub cols: u16,
    /// Dirty spans since the last snapshot or diff.  May be empty when only a
    /// resize or cursor move occurred.  Ordered top-down by row; within a row
    /// ordered left-to-right by `col_start`.
    pub dirty: Vec<DirtyRect>,
    /// Cursor position after processing the writes that produced this diff.
    pub cursor: CursorPos,
}
