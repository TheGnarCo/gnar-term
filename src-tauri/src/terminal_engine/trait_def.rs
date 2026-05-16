//! The `TerminalEngine` trait — the contract every terminal backend must implement.
//!
//! `Send` (not `Sync`) — callers hold the engine behind a `Mutex` and acquire
//! exclusive write access before calling any method (single-writer pattern).

use super::types::{CursorPos, DirtyRect, GridSnapshot};

/// A terminal state machine: parses VT/ANSI byte streams and exposes the
/// resulting grid state for rendering.
pub trait TerminalEngine: Send {
    /// Feed raw bytes (PTY output) into the terminal parser.
    fn feed(&mut self, bytes: &[u8]);

    /// Resize the terminal viewport to `cols` × `rows`.
    fn resize(&mut self, cols: u16, rows: u16);

    /// Return a snapshot of the full viewport grid.
    fn snapshot(&self) -> GridSnapshot;

    /// Return the list of dirty rects since the last call and reset the damage
    /// tracking state.
    fn damage(&mut self) -> Vec<DirtyRect>;

    /// Reset the internal damage tracking without consuming a damage report.
    /// Useful to discard the initial full-damage on construction.
    fn reset_damage(&mut self);

    /// Current cursor position and visibility.
    fn cursor_position(&self) -> CursorPos;
}
