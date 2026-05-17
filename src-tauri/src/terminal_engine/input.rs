//! Input parity helpers for the alacritty terminal engine (cycle-19).
//!
//! # Overview
//!
//! This module surfaces what the TS side needs to implement full input parity
//! with the xterm path:
//!
//! **`bracketed_paste_enabled`** — queries whether a `Term` instance currently
//! has DEC private mode 2004 (bracketed paste) set. The TS paste handler
//! (`paste-handler.ts`) needs this to decide whether to wrap pasted text in
//! `\x1b[200~…\x1b[201~`.
//!
//! # Integration note (for cycle-21)
//!
//! 1. Add `pub mod input;` to `mod.rs` (cycle-21 owns `mod.rs`).
//! 2. Expose `bracketed_paste_enabled` as a Tauri command by adding a thin
//!    wrapper in `src-tauri/src/lib.rs` that reads the engine from Tauri state
//!    and calls `bracketed_paste_enabled(engine.term())`.
//!
//! The function is generic over the `EventListener` so it works with both
//! `MyListener` (production) and `VoidListener` (tests).

use alacritty_terminal::event::EventListener;
use alacritty_terminal::term::TermMode;
use alacritty_terminal::Term;

// ─── Core helper ─────────────────────────────────────────────────────────────

/// Returns `true` when the terminal currently has bracketed paste mode
/// (DEC private mode 2004, `?2004h`) set.
///
/// The terminal parser in `alacritty_terminal` handles the DEC set/reset
/// sequences automatically when PTY data is fed via `Processor::advance`.
/// This function queries the live `TermMode` bitfield.
///
/// # Arguments
///
/// * `term` — a live `alacritty_terminal::Term` instance. In production this
///   is `AlacrittyEngine`'s internal `Term<MyListener>`; in tests it is
///   typically a `Term<VoidListener>`.
///
/// # Example (production pseudo-code)
///
/// ```rust,ignore
/// // After feeding ?2004h from the PTY:
/// let engine_guard = state.lock().unwrap();
/// let enabled = bracketed_paste_enabled(engine_guard.term());
/// channel.send(InputStateMessage::BracketedPaste(enabled))?;
/// ```
pub fn bracketed_paste_enabled<L: EventListener>(term: &Term<L>) -> bool {
    term.mode().contains(TermMode::BRACKETED_PASTE)
}

// Tests live in terminal_engine/input_tests.rs, registered from mod.rs.
