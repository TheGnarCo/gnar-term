//! MCP UDS bridge. A tokio task inside the GUI process that binds a Unix
//! domain socket, forwards newline-delimited JSON-RPC messages from the socket
//! to the webview as `mcp-request` events, and writes `mcp-response` events
//! back to the socket.
//!
//! Rust has ZERO knowledge of MCP or JSON-RPC. It is a byte pipe between the
//! `gnar-term --mcp-stdio` shim and the webview's MCP server.
//!
//! Security: the socket is chmod'd 600 so only the owning user can connect.
//! Same-user threat boundary matches iTerm2/WezTerm local-IPC practice.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Listener};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;

pub const REQUEST_EVENT: &str = "mcp-request";
pub const RESPONSE_EVENT: &str = "mcp-response";

/// Resolve the UDS path for the current platform.
///
/// - macOS: `~/Library/Application Support/gnar-term/mcp.sock`
/// - Linux: `$XDG_RUNTIME_DIR/gnar-term/mcp.sock` (fallback `~/.config/gnar-term/mcp.sock`)
/// - Windows: `%LOCALAPPDATA%\gnar-term\mcp.sock`
pub fn uds_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").ok()?;
        Some(PathBuf::from(format!(
            "{home}/Library/Application Support/gnar-term/mcp.sock"
        )))
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(runtime) = std::env::var("XDG_RUNTIME_DIR") {
            if !runtime.is_empty() {
                return Some(PathBuf::from(format!("{runtime}/gnar-term/mcp.sock")));
            }
        }
        let home = std::env::var("HOME").ok()?;
        Some(PathBuf::from(format!("{home}/.config/gnar-term/mcp.sock")))
    }
    #[cfg(target_os = "windows")]
    {
        let localappdata = std::env::var("LOCALAPPDATA").ok()?;
        Some(PathBuf::from(format!(
            "{localappdata}\\gnar-term\\mcp.sock"
        )))
    }
}

#[cfg(unix)]
fn set_socket_perms(path: &std::path::Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(path)?.permissions();
    perms.set_mode(0o600);
    std::fs::set_permissions(path, perms)
}

#[cfg(not(unix))]
fn set_socket_perms(_path: &std::path::Path) -> std::io::Result<()> {
    Ok(())
}

/// Handle for the currently active connection's response writer side. When a
/// connection is accepted, a new sender is installed here; responses emitted by
/// the webview are routed to that sender and written to the connection's
/// socket. When the connection drops, the sender is cleared.
type ActiveWriter = Arc<Mutex<Option<mpsc::UnboundedSender<String>>>>;

#[derive(Clone)]
pub struct BridgeState {
    active_writer: ActiveWriter,
}

impl BridgeState {
    pub fn new() -> Self {
        Self {
            active_writer: Arc::new(Mutex::new(None)),
        }
    }
}

impl Default for BridgeState {
    fn default() -> Self {
        Self::new()
    }
}

/// Install the global `mcp-response` listener. Every response emitted by the
/// webview is forwarded to the active connection's writer, if any. Safe to
/// call once on startup.
pub fn install_response_listener(app: AppHandle, state: BridgeState) {
    let writer = state.active_writer.clone();
    app.listen(RESPONSE_EVENT, move |event| {
        let payload = event.payload();
        // Events arrive with the payload JSON-encoded by Tauri. Expected shape:
        //   { "payload": "<raw json-rpc string>" }
        // Extract the inner string without adding serde_derive churn for a
        // tiny wrapper.
        let inner: Option<String> = serde_json::from_str::<serde_json::Value>(payload)
            .ok()
            .and_then(|v| v.get("payload").and_then(|p| p.as_str()).map(String::from))
            .or_else(|| serde_json::from_str::<String>(payload).ok());
        let Some(line) = inner else { return };
        if let Ok(guard) = writer.lock() {
            if let Some(tx) = guard.as_ref() {
                let _ = tx.send(line);
            }
        }
    });
}

/// Bind the UDS and serve connections forever. Returns immediately after
/// spawning the task. Only one connection is serviced at a time.
#[cfg(unix)]
pub fn spawn(app: AppHandle, state: BridgeState) -> Result<(), String> {
    use tokio::net::UnixListener;

    let path = uds_path().ok_or_else(|| "failed to resolve UDS path".to_string())?;

    // Ensure parent directory exists.
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
    }

    // Remove stale socket if a previous run left it behind.
    if path.exists() {
        let _ = std::fs::remove_file(&path);
    }

    install_response_listener(app.clone(), state.clone());

    let path_clone = path.clone();
    let app_for_task = app.clone();
    tauri::async_runtime::spawn(async move {
        let listener = match UnixListener::bind(&path_clone) {
            Ok(l) => l,
            Err(e) => {
                eprintln!(
                    "[mcp-bridge] failed to bind {}: {e} (another gnar-term instance may be running)",
                    path_clone.display()
                );
                return;
            }
        };
        if let Err(e) = set_socket_perms(&path_clone) {
            eprintln!("[mcp-bridge] failed to chmod {}: {e}", path_clone.display());
        }
        eprintln!("[mcp-bridge] listening on {}", path_clone.display());

        loop {
            let (stream, _) = match listener.accept().await {
                Ok(pair) => pair,
                Err(e) => {
                    eprintln!("[mcp-bridge] accept error: {e}");
                    continue;
                }
            };
            handle_connection(stream, app_for_task.clone(), state.clone()).await;
        }
    });

    // Install a shutdown hook to remove the socket on exit.
    let cleanup_path = path.clone();
    let _ = app.listen("tauri://close-requested", move |_| {
        let _ = std::fs::remove_file(&cleanup_path);
    });

    Ok(())
}

#[cfg(not(unix))]
pub fn spawn(_app: AppHandle, _state: BridgeState) -> Result<(), String> {
    // Windows uses AF_UNIX via the stdlib on Win10 1803+. tokio's UnixListener
    // is unix-only, so we stub the MVP to the unix path and plan a Windows
    // named-pipe fallback as a follow-up.
    Err("MCP bridge UDS not yet supported on this platform".to_string())
}

#[cfg(unix)]
async fn handle_connection(stream: tokio::net::UnixStream, app: AppHandle, state: BridgeState) {
    let (read_half, mut write_half) = stream.into_split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    // Install this connection's writer as the active one. On drop it will be
    // replaced; the guard below restores None on exit.
    {
        let mut guard = state.active_writer.lock().unwrap();
        *guard = Some(tx.clone());
    }

    // Task: pump responses from channel to socket.
    let writer_task = tauri::async_runtime::spawn(async move {
        while let Some(line) = rx.recv().await {
            if write_half.write_all(line.as_bytes()).await.is_err() {
                break;
            }
            if write_half.write_all(b"\n").await.is_err() {
                break;
            }
            let _ = write_half.flush().await;
        }
    });

    // Read loop: one line per JSON-RPC message; emit as Tauri event.
    let mut reader = BufReader::new(read_half);
    let mut buf = String::new();
    loop {
        buf.clear();
        match reader.read_line(&mut buf).await {
            Ok(0) => break, // EOF
            Ok(_) => {
                // Strip trailing newline, ignore empty heartbeat lines.
                let trimmed = buf.trim_end_matches(['\r', '\n']).to_string();
                if trimmed.is_empty() {
                    continue;
                }
                // Emit the raw line as the event payload. Webview receives
                // `{ payload: "<raw json>" }`.
                let _ = app.emit(REQUEST_EVENT, trimmed);
            }
            Err(_) => break,
        }
    }

    // Connection closed. Clear active writer and terminate the writer task.
    {
        let mut guard = state.active_writer.lock().unwrap();
        *guard = None;
    }
    drop(tx);
    let _ = writer_task.await;
}

/// Run the `--mcp-stdio` byte pipe: open the UDS, copy stdin ↔ socket ↔ stdout.
/// Blocks until one side closes. Returns a non-zero-worthy error on failure.
#[cfg(unix)]
pub fn run_stdio_shim() -> i32 {
    use tokio::io::{stdin, stdout};
    use tokio::net::UnixStream;

    let Some(path) = uds_path() else {
        eprintln!("gnar-term: failed to resolve MCP socket path");
        return 1;
    };

    if !path.exists() {
        eprintln!("gnar-term is not running. Start gnar-term and try again.");
        return 1;
    }

    let rt = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("gnar-term: failed to start async runtime: {e}");
            return 1;
        }
    };

    rt.block_on(async move {
        let stream = match UnixStream::connect(&path).await {
            Ok(s) => s,
            Err(e) => {
                eprintln!("gnar-term is not running. Start gnar-term and try again. ({e})");
                return 1;
            }
        };
        let (mut sock_r, mut sock_w) = stream.into_split();
        let mut stdin = stdin();
        let mut stdout = stdout();

        let a = async {
            let _ = tokio::io::copy(&mut stdin, &mut sock_w).await;
            let _ = sock_w.shutdown().await;
        };
        let b = async {
            let _ = tokio::io::copy(&mut sock_r, &mut stdout).await;
            let _ = stdout.shutdown().await;
        };
        tokio::join!(a, b);
        0
    })
}

#[cfg(not(unix))]
pub fn run_stdio_shim() -> i32 {
    eprintln!("gnar-term --mcp-stdio is not supported on this platform yet");
    1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uds_path_is_resolved() {
        // On CI and dev machines, HOME/LOCALAPPDATA are set; the function should
        // yield Some and the path should mention gnar-term.
        let p = uds_path().expect("uds_path should resolve");
        let s = p.to_string_lossy();
        assert!(
            s.contains("gnar-term"),
            "uds path should contain gnar-term: {s}"
        );
        assert!(
            s.ends_with("mcp.sock"),
            "uds path should end in mcp.sock: {s}"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn uds_round_trip_bytes() {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
        use tokio::net::{UnixListener, UnixStream};

        let dir = tempfile_dir();
        let path = dir.join("test.sock");
        let _ = std::fs::remove_file(&path);
        let listener = match UnixListener::bind(&path) {
            Ok(l) => l,
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                eprintln!("[test] skipping uds_round_trip_bytes: sandbox forbids bind ({e})");
                return;
            }
            Err(e) => panic!("bind: {e}"),
        };

        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let (r, mut w) = stream.into_split();
            let mut reader = BufReader::new(r);
            let mut line = String::new();
            reader.read_line(&mut line).await.unwrap();
            assert!(line.contains("hello"));
            w.write_all(b"{\"pong\":true}\n").await.unwrap();
        });

        let client = UnixStream::connect(&path).await.expect("connect");
        let (r, mut w) = client.into_split();
        w.write_all(b"{\"hello\":1}\n").await.unwrap();
        let mut reader = BufReader::new(r);
        let mut line = String::new();
        reader.read_line(&mut line).await.unwrap();
        assert!(line.contains("pong"));

        server.await.unwrap();
        let _ = std::fs::remove_file(&path);
    }

    #[cfg(unix)]
    fn tempfile_dir() -> std::path::PathBuf {
        // Pick a writable tmp dir. TMPDIR honours the harness sandbox, and
        // falls back to std::env::temp_dir otherwise.
        let base =
            std::env::var("TMPDIR").map_or_else(|_| std::env::temp_dir(), std::path::PathBuf::from);
        let dir = base.join(format!("gnar-term-mcp-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }
}
