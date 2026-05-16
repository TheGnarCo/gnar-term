//! PTY <-> terminal-engine bridge (cycle-4, cycle-13).
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
//!
//! # OSC 52 clipboard (cycle-13)
//!
//! Programs that emit OSC 52 escape sequences (`\x1b]52;...`) expect the
//! terminal to read/write the system clipboard on their behalf. The bridge
//! routes these via a [`ClipboardAccess`] trait so production code uses the
//! Tauri clipboard plugin while tests use an in-memory [`TestClipboard`].
//!
//! `alacritty_terminal` pre-decodes the base64 in a `ClipboardStore` event
//! before emitting it — the payload is already plain UTF-8 text.
//! For a `ClipboardLoad` event the formatter supplied by alacritty re-encodes
//! the response back to base64 and wraps it in the correct OSC 52 response
//! sequence before returning it, so we only need to pass the clipboard text
//! to the formatter and write the result to the PTY.

use std::io::Write;

use alacritty_terminal::event::Event;
use alacritty_terminal::vte::ansi::Rgb;

use super::alacritty::AlacrittyEngine;
use super::ipc::GridDiff;
use super::trait_def::TerminalEngine;
use super::types::GridSnapshot;

// ─── ClipboardAccess trait ────────────────────────────────────────────────────

/// Abstraction over system clipboard access for testability.
///
/// Production code implements this via an `AppHandle` wrapper that delegates to
/// `tauri_plugin_clipboard_manager::ClipboardExt`. Tests use an in-memory
/// `TestClipboard` backed by `Arc<Mutex<String>>`.
///
/// Both methods return `Result<_, String>` so errors can be logged without
/// depending on any platform-specific error type.
pub trait ClipboardAccess: Send + Sync {
    /// Write `text` to the system clipboard.
    fn write_text(&self, text: String) -> Result<(), String>;

    /// Read the current system clipboard contents.
    ///
    /// Returns an empty string on Err so callers can always call the OSC 52
    /// formatter even when the clipboard is unavailable.
    fn read_text(&self) -> Result<String, String>;
}

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
///
/// # PTY writer (cycle-12)
///
/// `pty_writer` is an optional writer for sending response bytes back to the
/// PTY (e.g., OSC color-query responses). When `Some`, the bridge routes
/// `Event::PtyWrite` and `Event::ColorRequest` bytes through it.
///
/// ## Dual-writer invariant
///
/// Production callers (see `alacritty_commands.rs::attach_alacritty_engine`)
/// pass a writer obtained via `MasterPty::take_writer()`. This is *independent*
/// of the `PtyInstance::writer` stored in `AppState.ptys`. Both writers are
/// independent file-descriptor handles to the same PTY master; the kernel
/// multiplexes concurrent writes correctly. The `PtyInstance` writer is used for
/// normal keystroke forwarding (`write_pty`); the bridge writer is used only for
/// terminal-protocol responses (OSC queries etc.).
pub struct PtyBridge {
    engine: AlacrittyEngine,
    sink: Box<dyn MessageSink>,
    /// Optional writer for routing response bytes back to the PTY.
    ///
    /// `None` in test mode (no PTY to write to). `Some` in production when
    /// the bridge is created via `attach_alacritty_engine`.
    pty_writer: Option<Box<dyn Write + Send>>,
    /// Optional clipboard access for routing OSC 52 clipboard events.
    ///
    /// `None` when no clipboard is available (e.g. unit tests without a Tauri
    /// handle). `Some` in production when the bridge is created via
    /// `attach_alacritty_engine` with an `AppHandle`.
    clipboard: Option<Box<dyn ClipboardAccess>>,
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
    /// ## Arguments
    ///
    /// - `cols`, `rows` — initial viewport dimensions.
    /// - `sink` — message channel to the frontend.
    /// - `pty_writer` — optional writer for PTY response bytes (OSC query
    ///   responses etc.). Pass `None` in tests; pass
    ///   `Some(pty.master_pty.take_writer()?)` in production.
    /// - `clipboard` — optional clipboard access for OSC 52 events. Pass
    ///   `None` in tests that don't exercise clipboard; pass `Some(...)` with
    ///   an `AppHandleClipboard` wrapper in production.
    ///
    /// The initial full-damage produced by `AlacrittyEngine::new` is consumed
    /// by calling `reset_damage` before any caller-driven `feed_and_emit`
    /// calls, so the first diff won't include the entire blank viewport as
    /// dirty rects (which would double the data volume needlessly).
    pub fn new(
        cols: u16,
        rows: u16,
        sink: Box<dyn MessageSink>,
        pty_writer: Option<Box<dyn Write + Send>>,
        clipboard: Option<Box<dyn ClipboardAccess>>,
    ) -> Self {
        let mut engine = AlacrittyEngine::new(cols, rows);
        // Discard the initial full-damage so the first real diff is clean.
        engine.reset_damage();

        let snapshot = engine.snapshot();
        let bridge = Self {
            engine,
            sink,
            pty_writer,
            clipboard,
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
    /// drained and routed:
    ///
    /// - `Event::PtyWrite(text)` → `pty_writer.write_all(text.as_bytes())`.
    ///   Programs that issue OSC queries expect this response; without it they
    ///   hang indefinitely. (Previously the TODO: pty-write-routing deferral.)
    ///
    /// - `Event::ColorRequest(index, formatter)` → looks up `engine.colors()[index]`;
    ///   if `Some(rgb)`, calls `formatter(rgb)` to produce the response string and
    ///   writes it through `pty_writer`. If `None`, a sane default Rgb is computed
    ///   (see inline comment) and used as the fallback.
    ///
    /// - `Event::ClipboardLoad` / `Event::ClipboardStore` → logged at `warn!` with
    ///   a TODO; OSC 52 clipboard plumbing is deferred to a future cycle.
    ///   // TODO(clipboard-osc52): route OSC 52 via tauri-plugin-clipboard or arboard.
    ///
    /// - All other events → `log::debug!`.
    ///
    /// If `pty_writer` is `None` (test mode), `PtyWrite` and `ColorRequest` are
    /// logged at debug level only — no panic.
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

        // Drain and route all events emitted during this parse cycle.
        for event in self.engine.drain_events() {
            match event {
                Event::PtyWrite(ref text) => {
                    self.write_to_pty(text.as_bytes(), "PtyWrite");
                }
                Event::ColorRequest(index, ref formatter) => {
                    // Look up the color in the engine's color table.
                    // Falls back to a default Rgb when the slot is None:
                    //   - Indices 0-15: conventional ANSI palette defaults are not
                    //     stored in the color table unless explicitly set; we use
                    //     white (Rgb {r:255,g:255,b:255}) as a safe default because
                    //     terminals without a config typically show a bright foreground.
                    //   - Named slots (256=Foreground, 257=Background, 258=Cursor):
                    //     use white / black / white respectively.
                    //   - 256-color cube / grayscale: use white as a conservative default.
                    // The exact color used here matters only for programs that parse the
                    // query response; the critical correctness goal is to send *a* response
                    // so the program doesn't hang.
                    let colors = self.engine.colors();
                    let rgb = colors[index].unwrap_or(
                        // Named background slot (index 257) → black; everything else → white.
                        if index == 257 {
                            Rgb { r: 0, g: 0, b: 0 }
                        } else {
                            Rgb {
                                r: 255,
                                g: 255,
                                b: 255,
                            }
                        },
                    );
                    let response = formatter(rgb);
                    self.write_to_pty(response.as_bytes(), "ColorRequest");
                }
                Event::ClipboardStore(_clip_type, ref text) => {
                    // alacritty_terminal pre-decodes the base64 payload before
                    // emitting ClipboardStore — the text is already plain UTF-8.
                    self.write_to_clipboard(text.clone());
                }
                Event::ClipboardLoad(_clip_type, ref formatter) => {
                    // Read the current clipboard text (empty string on error),
                    // pass it through the alacritty formatter which re-encodes
                    // it as a valid OSC 52 response, then write that back to
                    // the PTY so the requesting program receives its answer.
                    let text = self.read_from_clipboard();
                    let response = formatter(&text);
                    self.write_to_pty(response.as_bytes(), "ClipboardLoad");
                }
                other => {
                    log::debug!("[alacritty_engine] event: {other:?}");
                }
            }
        }
    }

    /// Write `data` to `pty_writer` if present; log at debug on success,
    /// warn on I/O error. No-op (debug log only) when `pty_writer` is `None`.
    fn write_to_pty(&mut self, data: &[u8], label: &str) {
        if let Some(ref mut writer) = self.pty_writer {
            match writer.write_all(data).and_then(|()| writer.flush()) {
                Ok(()) => {
                    log::debug!(
                        "[alacritty_engine] {label}: wrote {} bytes to pty_writer",
                        data.len()
                    );
                }
                Err(e) => {
                    log::warn!("[alacritty_engine] {label}: failed to write to pty_writer: {e}");
                }
            }
        } else {
            log::debug!(
                "[alacritty_engine] {label}: no pty_writer (test mode), {} bytes discarded",
                data.len()
            );
        }
    }

    /// Write `text` to the clipboard access sink if present.
    ///
    /// Logs at `warn` on clipboard write error; logs at `debug` when no
    /// clipboard access is configured (e.g. unit tests).
    fn write_to_clipboard(&self, text: String) {
        if let Some(ref clipboard) = self.clipboard {
            if let Err(e) = clipboard.write_text(text) {
                log::warn!("[alacritty_engine] ClipboardStore: failed to write clipboard: {e}");
            } else {
                log::debug!("[alacritty_engine] ClipboardStore: wrote text to clipboard");
            }
        } else {
            log::debug!(
                "[alacritty_engine] ClipboardStore: no clipboard access (test mode), store ignored"
            );
        }
    }

    /// Read text from the clipboard access sink, returning an empty string if
    /// no clipboard is configured or the read fails.
    fn read_from_clipboard(&self) -> String {
        if let Some(ref clipboard) = self.clipboard {
            match clipboard.read_text() {
                Ok(text) => {
                    log::debug!(
                        "[alacritty_engine] ClipboardLoad: read {} bytes from clipboard",
                        text.len()
                    );
                    text
                }
                Err(e) => {
                    log::warn!("[alacritty_engine] ClipboardLoad: failed to read clipboard: {e}; using empty string");
                    String::new()
                }
            }
        } else {
            log::debug!(
                "[alacritty_engine] ClipboardLoad: no clipboard access (test mode), using empty string"
            );
            String::new()
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
