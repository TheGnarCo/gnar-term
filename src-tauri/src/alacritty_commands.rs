//! Tauri IPC commands for the Alacritty terminal engine bridge.
//!
//! These commands live in a dedicated module (rather than `lib.rs`) because
//! `#[tauri::command]` emits macro names into the declaring module's namespace.
//! Placing them in a sub-module avoids symbol conflicts with `generate_handler!`
//! in `lib.rs`.

use crate::pty::AppState;
use crate::terminal_engine::pty_bridge::{
    ClipboardAccess, PtyBridge, TauriChannelSink, TerminalChannelMessage,
};

// ─── AppHandleClipboard ───────────────────────────────────────────────────────

/// Production [`ClipboardAccess`] implementation backed by a Tauri `AppHandle`.
///
/// Delegates to `tauri_plugin_clipboard_manager::ClipboardExt`, which is
/// already registered in `lib.rs`. Storing the `AppHandle` (rather than the
/// `Clipboard` state directly) keeps the wrapper `Send + Sync` without
/// needing to negotiate the plugin's internal Mutex lifetimes.
struct AppHandleClipboard {
    app: tauri::AppHandle,
}

impl AppHandleClipboard {
    fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }
}

impl ClipboardAccess for AppHandleClipboard {
    fn write_text(&self, text: String) -> Result<(), String> {
        use tauri_plugin_clipboard_manager::ClipboardExt;
        self.app
            .clipboard()
            .write_text(text)
            .map_err(|e| e.to_string())
    }

    fn read_text(&self) -> Result<String, String> {
        use tauri_plugin_clipboard_manager::ClipboardExt;
        self.app.clipboard().read_text().map_err(|e| e.to_string())
    }
}

/// Attach an Alacritty terminal engine to an existing PTY pane.
///
/// Registers a `Channel<TerminalChannelMessage>` for `pty_id` and immediately
/// sends an initial `GridSnapshot` carrying the full (blank) viewport grid.
///
/// # Why a Snapshot on attach
///
/// The renderer needs a baseline grid before it can apply incremental diffs.
/// Sending a snapshot synchronously on attach guarantees the ordering
/// invariant: snapshot before any diff.
///
/// # Resize behaviour
///
/// When `resize_alacritty_engine` is called on a pane that has an attached
/// engine, the engine is resized and a fresh `Snapshot` (not a `Diff`) is
/// emitted. Rationale: `alacritty_terminal` reflows the entire grid on resize;
/// every cell may change position, so a diff would need to mark the whole
/// viewport as dirty anyway. Sending a snapshot is cleaner and lets the
/// renderer discard + repaint from scratch.
///
/// # Channel drop
///
/// If the frontend drops its channel subscription (pane close, navigation),
/// subsequent `send()` calls return `Err`. The bridge swallows these errors
/// silently (logged at debug level). The bridge entry remains in `AppState`
/// until `kill_pty` removes it.
///
/// # OSC 52 clipboard (cycle-13)
///
/// `app` is a Tauri-injected `AppHandle` used to construct the
/// `AppHandleClipboard` wrapper. OSC 52 store/load events are routed through
/// the Tauri clipboard plugin (`tauri-plugin-clipboard-manager`), which is
/// already registered in `lib.rs`.
#[tauri::command]
pub(crate) async fn attach_alacritty_engine(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    pty_id: u32,
    channel: tauri::ipc::Channel<TerminalChannelMessage>,
) -> Result<(), String> {
    // Determine the current PTY viewport size so the engine matches.
    let (cols, rows) = {
        let ptys = state.ptys.lock().map_err(|e| e.to_string())?;
        let pty = ptys
            .get(&pty_id)
            .ok_or_else(|| format!("PTY {pty_id} not found"))?;
        // Portable-pty's `MasterPty::get_size()` returns the current PTY size.
        // Fall back to a standard 80×24 if the query fails (e.g. on some
        // platforms the query is a no-op and returns Err).
        match pty.master_pty.get_size() {
            Ok(sz) => (sz.cols, sz.rows),
            Err(e) => {
                log::warn!(
                    "[attach_alacritty_engine] get_size failed for pty_id={pty_id}: {e}; defaulting to 80x24"
                );
                (80, 24)
            }
        }
    };

    // Acquire a second, independent writer handle for the PTY so the bridge
    // can route terminal-protocol responses (OSC color queries etc.) back to
    // the PTY without contending with the normal keystroke writer stored in
    // `PtyInstance::writer`.
    //
    // Dual-writer invariant: `MasterPty::take_writer()` returns a fresh,
    // independent file-descriptor handle each time it is called. The kernel
    // multiplexes concurrent writes to the same PTY master correctly. The
    // `PtyInstance::writer` continues to be used for `write_pty` keystrokes;
    // this bridge writer is used only for terminal-protocol response bytes.
    let bridge_writer: Option<Box<dyn std::io::Write + Send>> = {
        let ptys = state.ptys.lock().map_err(|e| e.to_string())?;
        let pty = ptys
            .get(&pty_id)
            .ok_or_else(|| format!("PTY {pty_id} not found for writer acquisition"))?;
        match pty.master_pty.take_writer() {
            Ok(w) => Some(w),
            Err(e) => {
                log::warn!(
                    "[attach_alacritty_engine] take_writer failed for pty_id={pty_id}: {e}; \
                     color queries will not be responded to"
                );
                None
            }
        }
    };

    let sink = TauriChannelSink::new(channel);
    // Wrap the AppHandle as a ClipboardAccess sink for OSC 52 routing.
    let clipboard: Option<Box<dyn ClipboardAccess>> = Some(Box::new(AppHandleClipboard::new(app)));
    // PtyBridge::new emits the initial Snapshot synchronously — ordering
    // invariant is satisfied before this function returns.
    let bridge = PtyBridge::new(cols, rows, Box::new(sink), bridge_writer, clipboard);

    let mut bridges = state.bridges.lock().map_err(|e| e.to_string())?;
    bridges.insert(pty_id, bridge);

    Ok(())
}

/// Feed raw PTY bytes into the Alacritty engine attached to `pty_id` and
/// emit a `GridDiff` over the registered channel.
///
/// If no engine is attached for `pty_id`, this is a no-op.
#[tauri::command]
pub(crate) async fn feed_alacritty_engine(
    state: tauri::State<'_, AppState>,
    pty_id: u32,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let mut bridges = state.bridges.lock().map_err(|e| e.to_string())?;
    if let Some(bridge) = bridges.get_mut(&pty_id) {
        bridge.feed_and_emit(&bytes);
    }
    Ok(())
}

/// Detach the Alacritty engine from `pty_id`, releasing the bridge entry.
///
/// This is the explicit teardown path for the bridge: removing the entry drops
/// the `PtyBridge` (and its `AlacrittyEngine`), freeing per-pane memory.
/// Call this from the frontend when a pane is closed or navigated away from.
///
/// `kill_pty` also removes the bridge entry as a safety net for non-detach
/// shutdown paths (e.g. process exit before frontend cleanup).
#[tauri::command]
pub(crate) async fn detach_alacritty_engine(
    state: tauri::State<'_, AppState>,
    pty_id: u32,
) -> Result<(), String> {
    let mut bridges = state.bridges.lock().map_err(|e| e.to_string())?;
    bridges.remove(&pty_id);
    Ok(())
}

/// Resize the Alacritty engine attached to `pty_id` to `cols × rows` and
/// emit a fresh `GridSnapshot`.
///
/// If no engine is attached, this is a no-op. Call this alongside the
/// existing `resize_pty` command when the pane viewport changes.
#[tauri::command]
pub(crate) async fn resize_alacritty_engine(
    state: tauri::State<'_, AppState>,
    pty_id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let mut bridges = state.bridges.lock().map_err(|e| e.to_string())?;
    if let Some(bridge) = bridges.get_mut(&pty_id) {
        bridge.resize_and_emit(cols, rows);
    }
    Ok(())
}
