//! PTY <-> terminal-engine bridge (cycle-4).
//!
//! # Overview
//!
//! [`PtyBridge`] owns one [`AlacrittyEngine`] per PTY pane. It converts raw
//! PTY bytes into structured [`TerminalChannelMessage`] payloads and dispatches
//! them over a [`MessageSink`] (production: a Tauri `Channel`; tests: a
//! `Vec`-backed recorder).
//!
//! # Protocol
//!
//! On **attach**: one `Snapshot` carrying the full viewport grid.
//! On each **feed**: one `Diff` carrying only the dirty spans since the last
//! snapshot or diff. Cursor position is embedded in every `Diff`.
//!
//! # Resize invariant
//!
//! When the pane is resized, the engine reflows the grid (`alacritty_terminal`
//! internally rebuilds line storage on resize). Because *every* cell may
//! change position, we emit a fresh `Snapshot` rather than a `Diff`.
//! This lets the renderer discard its current grid and repaint from scratch
//! without needing to track which cells are actually different.
//!
//! # Ordering guarantee
//!
//! The `Snapshot` is sent synchronously during [`PtyBridge::new`]. All
//! subsequent `Diff` payloads are produced by [`PtyBridge::feed_and_emit`]
//! and [`PtyBridge::resize_and_emit`], which are called by the same thread
//! that drives the PTY reader loop. There is no concurrency within a single
//! bridge, so the ordering invariant (snapshot before any diff) is structural.
//!
//! # Channel emission error handling
//!
//! If the `MessageSink::send` call returns `Err` (e.g. because the frontend
//! dropped its channel subscription), the error is logged at debug level and
//! silently discarded. The PTY reader loop and the engine state continue
//! operating; the caller can decide to drop the bridge when they detect the
//! channel is gone via a separate signal (e.g. pane close).

use alacritty_terminal::event::Event;

use super::alacritty::AlacrittyEngine;
use super::ipc::GridDiff;
use super::trait_def::TerminalEngine;
use super::types::GridSnapshot;

// ─── TerminalChannelMessage ───────────────────────────────────────────────────

/// The tagged-union payload sent over the Tauri `Channel`.
///
/// Matches the TypeScript discriminated union in `src/lib/types/terminal-ipc.ts`:
/// `{ kind: "snapshot"; value: GridSnapshot } | { kind: "diff"; value: GridDiff }`.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "kind", content = "value", rename_all = "lowercase")]
pub enum TerminalChannelMessage {
    /// Full viewport grid — sent on attach and after resize.
    Snapshot(GridSnapshot),
    /// Incremental damage update — sent after each PTY byte feed.
    Diff(GridDiff),
}

// ─── MessageSink trait ────────────────────────────────────────────────────────

/// Abstraction over Tauri `Channel` for testability.
///
/// The production implementation wraps `tauri::ipc::Channel<TerminalChannelMessage>`.
/// The test implementation wraps a `Vec<TerminalChannelMessage>` behind a `Mutex`.
///
/// `Send` is required so bridges can live in `AppState` behind a `Mutex`.
pub trait MessageSink: Send {
    /// Send one message to the subscriber.
    ///
    /// Returns `Err` when the receiver has been dropped. The bridge treats
    /// this as a no-op: it logs the error at debug level and continues.
    fn send(&self, msg: TerminalChannelMessage) -> Result<(), String>;
}

// ─── Tauri Channel adapter ────────────────────────────────────────────────────

/// Production `MessageSink` backed by a `tauri::ipc::Channel`.
pub struct TauriChannelSink {
    channel: tauri::ipc::Channel<TerminalChannelMessage>,
}

impl TauriChannelSink {
    /// Wrap a Tauri Channel as a `MessageSink`.
    pub fn new(channel: tauri::ipc::Channel<TerminalChannelMessage>) -> Self {
        Self { channel }
    }
}

impl MessageSink for TauriChannelSink {
    fn send(&self, msg: TerminalChannelMessage) -> Result<(), String> {
        self.channel.send(msg).map_err(|e| e.to_string())
    }
}

// ─── PtyBridge ────────────────────────────────────────────────────────────────

/// Per-pane bridge that owns an [`AlacrittyEngine`] and emits
/// [`TerminalChannelMessage`] payloads to a [`MessageSink`].
pub struct PtyBridge {
    engine: AlacrittyEngine,
    sink: Box<dyn MessageSink>,
    /// Cached viewport width — updated in `new` and `resize_and_emit`.
    ///
    /// Avoids calling `engine.snapshot()` (O(rows × cols)) on every
    /// `feed_and_emit` just to read two `u16` values.
    cols: u16,
    /// Cached viewport height — updated in `new` and `resize_and_emit`.
    rows: u16,
}

impl PtyBridge {
    /// Create a new bridge, size the engine to `cols × rows`, and emit the
    /// initial `Snapshot` to the sink.
    ///
    /// The initial full-damage produced by `AlacrittyEngine::new` is consumed
    /// by calling `reset_damage` before any caller-driven `feed_and_emit`
    /// calls, so the first diff won't include the entire blank viewport as
    /// dirty rects (which would double the data volume needlessly).
    pub fn new(cols: u16, rows: u16, sink: Box<dyn MessageSink>) -> Self {
        let mut engine = AlacrittyEngine::new(cols, rows);
        // Discard the initial full-damage so the first real diff is clean.
        engine.reset_damage();

        let snapshot = engine.snapshot();
        let bridge = Self {
            engine,
            sink,
            cols,
            rows,
        };

        // Emit initial snapshot. If the sink is already gone (test double that
        // returns Err, or receiver already dropped), swallow silently.
        let _ = bridge.emit(TerminalChannelMessage::Snapshot(snapshot));

        bridge
    }

    /// Feed raw PTY bytes into the engine and emit a `Diff` for the resulting
    /// damage. If no cells changed, a `Diff` with an empty `dirty` list is
    /// still emitted so the renderer can update cursor position.
    ///
    /// After computing the diff, all buffered events from `AlacrittyEngine` are
    /// drained and logged. `Event::PtyWrite` events carry response bytes that
    /// should be written back to the PTY (e.g., OSC color-query responses); they
    /// are logged here but **not yet routed to the PTY writer**. Full write-back
    /// routing requires cross-component plumbing with `AppState.ptys` and is
    /// deferred to a follow-up cycle. The drain prevents silent event loss —
    /// the queue is cleared so it does not grow unboundedly.
    pub fn feed_and_emit(&mut self, bytes: &[u8]) {
        self.engine.feed(bytes);
        let dirty = self.engine.damage();
        let cursor = self.engine.cursor_position();
        let diff = GridDiff {
            rows: self.rows,
            cols: self.cols,
            dirty,
            cursor,
        };
        let _ = self.emit(TerminalChannelMessage::Diff(diff));

        // Drain and log all events emitted during this parse cycle.
        // TODO(pty-write-routing): PtyWrite bytes must be written back to the
        // PTY to unblock programs that issue OSC queries. Implement in the
        // follow-up cycle that adds a pty_write_sink to PtyBridge.
        for event in self.engine.drain_events() {
            match &event {
                Event::PtyWrite(text) => {
                    log::debug!(
                        "[alacritty_engine] PtyWrite ({} bytes): buffered — \
                         routing to PTY writer deferred (see TODO pty-write-routing)",
                        text.len()
                    );
                }
                other => {
                    log::debug!("[alacritty_engine] event: {other:?}");
                }
            }
        }
    }

    /// Resize the engine viewport to `cols × rows` and emit a fresh `Snapshot`.
    ///
    /// A `Snapshot` (not a `Diff`) is sent because `alacritty_terminal` reflows
    /// the entire grid on resize, which can change every cell's position. The
    /// renderer must discard its current grid and repaint from scratch.
    pub fn resize_and_emit(&mut self, cols: u16, rows: u16) {
        // Update cached dims before resize so they're consistent with the
        // engine's state once `engine.resize` returns.
        self.cols = cols;
        self.rows = rows;
        self.engine.resize(cols, rows);
        // After resize, reset damage so the next feed produces a clean diff
        // rather than a diff that redundantly covers the full reflow.
        self.engine.reset_damage();
        let snapshot = self.engine.snapshot();
        let _ = self.emit(TerminalChannelMessage::Snapshot(snapshot));
    }

    // ─── Private helpers ─────────────────────────────────────────────────────

    fn emit(&self, msg: TerminalChannelMessage) -> Result<(), String> {
        // Errors here mean the channel receiver was dropped (frontend closed
        // the pane or navigated away). Swallow — the bridge continues to
        // maintain engine state until the caller drops the bridge entry.
        self.sink.send(msg).map_err(|e| {
            log::debug!("[pty_bridge] sink send error (receiver dropped?): {e}");
            e
        })
    }
}
