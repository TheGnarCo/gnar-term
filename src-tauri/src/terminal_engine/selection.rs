//! Selection state management — AC-2 selection + clipboard parity.
//!
//! This module wraps `alacritty_terminal::selection::Selection` to provide:
//!
//! - A mutable `SelectionState` (owned `Option<Selection>` + a dirty flag for
//!   copy-on-selection-change, AC-2).
//! - Three mutating operations: `start_selection`, `update_selection`,
//!   `clear_selection`.
//! - A read-only query: `get_selection_text(state, provider) -> Option<String>`.
//! - A serde-friendly `IpcSelectionRange` for sending the selection range over
//!   the Tauri Channel so the renderer can highlight selected cells.
//!
//! # copy-on-selection-change
//!
//! `SelectionState::changed_since_last_check` is raised (set to `true`) by
//! every mutating operation. cycle-21 reads this flag after each mouse event,
//! copies the selected text to the clipboard when `true`, then resets it.
//!
//! # Tauri command surface
//!
//! The three public `#[tauri::command]` handlers are **declared here but not
//! registered**. Registration (in `generate_handler!`) is cycle-21's job.
//! See README-context-resume.md for the Wave-A convention.
//!
//! # `SelectionTextProvider` trait
//!
//! Because Wave-A cycles must not modify `alacritty.rs`, text extraction uses a
//! `SelectionTextProvider` trait that `AlacrittyEngine` will implement in
//! cycle-21 (one extra `impl` block is acceptable as a new file or inline). In
//! tests, `MockTermProvider` serves as the test double.

use alacritty_terminal::index::{Point, Side};
use alacritty_terminal::selection::{Selection, SelectionType};

// ─── SelectionMode ────────────────────────────────────────────────────────────

/// The selection granularity for a new selection.
///
/// Maps to the three modes in the AC-2 requirement:
/// - `Simple` — cell-by-cell (corresponds to `SelectionType::Simple`).
/// - `Semantic` — word-boundary expansion (corresponds to `SelectionType::Semantic`).
/// - `Lines` — full-line expansion (corresponds to `SelectionType::Lines`).
///
/// `Block` (rectangle) mode is intentionally omitted from the AC-2 scope; add it
/// later if needed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SelectionMode {
    /// Cell-by-cell drag selection (single click + drag).
    Simple,
    /// Word-boundary selection (double click).
    Semantic,
    /// Full-line selection (triple click).
    Lines,
}

impl SelectionMode {
    /// Map to the `alacritty_terminal` selection type.
    pub fn to_alacritty_type(self) -> SelectionType {
        match self {
            SelectionMode::Simple => SelectionType::Simple,
            SelectionMode::Semantic => SelectionType::Semantic,
            SelectionMode::Lines => SelectionType::Lines,
        }
    }
}

// ─── SelectionTextProvider ────────────────────────────────────────────────────

/// Capability interface for extracting selection text from a terminal.
///
/// `AlacrittyEngine` implements this in `selection_provider.rs` (cycle-21 adds
/// that file plus the `mod selection_provider` declaration in `mod.rs`).
///
/// Test doubles implement `MockTermProvider` (defined in `selection_tests.rs`).
pub trait SelectionTextProvider {
    /// Install `sel` into the terminal state and return the selected text, if any.
    ///
    /// Implementors should:
    /// 1. Store the selection in `Term::selection`.
    /// 2. Call `Term::selection_to_string()`.
    /// 3. Clear `Term::selection` (leave the term unchanged).
    fn extract_selection_text(&mut self, sel: &Selection) -> Option<String>;
}

// ─── SelectionState ───────────────────────────────────────────────────────────

/// Mutable selection state for one terminal pane.
///
/// The `changed_since_last_check` flag supports **copy-on-selection-change**
/// (AC-2): it is raised by every mutating operation and read (then reset) by
/// the consumer (cycle-21) to trigger an automatic clipboard copy.
///
/// `SelectionState` is not `Send` by itself — wrap in `Arc<Mutex<…>>` when
/// crossing thread boundaries (same pattern as `AlacrittyEngine`).
#[derive(Debug, Default)]
pub struct SelectionState {
    /// The current in-progress or committed selection, if any.
    pub selection: Option<Selection>,

    /// Raised whenever the selection changes (start / update / clear).
    ///
    /// Consumers (cycle-21) read this flag to implement copy-on-selection-change,
    /// then reset it. The flag is `false` on a freshly constructed `SelectionState`.
    pub changed_since_last_check: bool,
}

// ─── Mutating operations ──────────────────────────────────────────────────────

/// Begin a new selection at `point` with the given `mode`.
///
/// Replaces any existing selection. Sets `changed_since_last_check`.
///
/// `Side::Left` is used for the initial anchor so that a click-at-column-N
/// selects the character at column N (not the gap between N-1 and N).
pub fn start_selection(state: &mut SelectionState, point: Point, mode: SelectionMode) {
    state.selection = Some(Selection::new(mode.to_alacritty_type(), point, Side::Left));
    state.changed_since_last_check = true;
}

/// Update the end of the active selection to `point`.
///
/// No-op (and does not set the flag) when no selection is active.
///
/// `Side::Right` is used for the end anchor so that a drag ending at column N
/// includes the character at column N (not truncates at N-1).
pub fn update_selection(state: &mut SelectionState, point: Point) {
    if let Some(ref mut sel) = state.selection {
        sel.update(point, Side::Right);
        state.changed_since_last_check = true;
    }
}

/// Clear the current selection. Sets `changed_since_last_check`.
pub fn clear_selection(state: &mut SelectionState) {
    state.selection = None;
    state.changed_since_last_check = true;
}

// ─── Text extraction ──────────────────────────────────────────────────────────

/// Extract the selected text from a terminal via the `SelectionTextProvider` trait.
///
/// Returns `None` when there is no active selection.
///
/// The provider temporarily installs the selection into its term state to call
/// `Term::selection_to_string`, then restores the term.
pub fn get_selection_text<P: SelectionTextProvider>(
    state: &SelectionState,
    provider: &mut P,
) -> Option<String> {
    let sel = state.selection.as_ref()?;
    provider.extract_selection_text(sel)
}

// ─── IPC wire type ────────────────────────────────────────────────────────────

/// Serde-friendly representation of a selection range for IPC.
///
/// This is sent over the Tauri Channel so the frontend renderer can highlight
/// selected cells. Coordinates are viewport-relative (0-indexed row/col).
///
/// The `is_block` field is reserved for future block-selection support; all
/// current modes produce `is_block: false`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct IpcSelectionRange {
    /// Start row (grid-relative `Line(i32)`).
    pub start_row: i32,
    /// Start column (inclusive, viewport-relative).
    pub start_col: usize,
    /// End row (grid-relative `Line(i32)`).
    pub end_row: i32,
    /// End column (inclusive, viewport-relative).
    pub end_col: usize,
    /// Whether this is a block (rectangle) selection.
    pub is_block: bool,
}

/// Convert an `alacritty_terminal::selection::SelectionRange` to `IpcSelectionRange`.
///
/// `SelectionRange::start` and `end` carry `Line(i32)` (grid-relative, negative
/// for scrollback) and `Column(usize)`.
pub fn to_ipc_range(range: &alacritty_terminal::selection::SelectionRange) -> IpcSelectionRange {
    IpcSelectionRange {
        start_row: range.start.line.0,
        start_col: range.start.column.0,
        end_row: range.end.line.0,
        end_col: range.end.column.0,
        is_block: range.is_block,
    }
}
