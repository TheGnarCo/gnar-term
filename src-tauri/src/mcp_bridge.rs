//! MCP UDS bridge. A tokio server inside the GUI process that binds a Unix
//! domain socket, accepts multiple concurrent connections, and forwards
//! newline-delimited JSON-RPC messages between each connection's socket and
//! the webview as `mcp-request` / `mcp-response` events.
//!
//! Rust has ZERO knowledge of MCP or JSON-RPC. It is a byte pipe between the
//! `gnar-term --mcp-stdio` shim and the webview's MCP server. The only
//! metadata Rust adds is a per-connection `connection_id` so the webview can
//! route requests, route responses, and isolate per-connection state.
//!
//! Security: the socket is chmod'd 600 so only the owning user can connect.
//! Same-user threat boundary matches iTerm2/WezTerm local-IPC practice.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Listener};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;

pub const REQUEST_EVENT: &str = "mcp-request";
pub const RESPONSE_EVENT: &str = "mcp-response";
pub const CONNECTION_CLOSED_EVENT: &str = "mcp-connection-closed";

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
            "{}/Library/Application Support/gnar-term/mcp.sock",
            home
        )))
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(runtime) = std::env::var("XDG_RUNTIME_DIR") {
            if !runtime.is_empty() {
                return Some(PathBuf::from(format!("{}/gnar-term/mcp.sock", runtime)));
            }
        }
        let home = std::env::var("HOME").ok()?;
        Some(PathBuf::from(format!(
            "{}/.config/gnar-term/mcp.sock",
            home
        )))
    }
    #[cfg(target_os = "windows")]
    {
        let localappdata = std::env::var("LOCALAPPDATA").ok()?;
        Some(PathBuf::from(format!(
            "{}\\gnar-term\\mcp.sock",
            localappdata
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

/// Per-connection writer registry. The bridge supports multiple concurrent
/// connections; each gets a unique `connection_id` and a writer channel that
/// the response listener routes to.
type ConnectionRegistry = Arc<Mutex<HashMap<u64, mpsc::UnboundedSender<String>>>>;

#[derive(Clone)]
pub struct BridgeState {
    connections: ConnectionRegistry,
    next_id: Arc<AtomicU64>,
}

impl BridgeState {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(AtomicU64::new(1)),
        }
    }

    fn next_connection_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    fn register(&self, id: u64, tx: mpsc::UnboundedSender<String>) {
        if let Ok(mut guard) = self.connections.lock() {
            guard.insert(id, tx);
        }
    }

    fn unregister(&self, id: u64) {
        if let Ok(mut guard) = self.connections.lock() {
            guard.remove(&id);
        }
    }

    fn send_to(&self, id: u64, payload: String) -> bool {
        let tx = match self.connections.lock() {
            Ok(g) => g.get(&id).cloned(),
            Err(_) => None,
        };
        if let Some(tx) = tx {
            tx.send(payload).is_ok()
        } else {
            false
        }
    }
}

impl Default for BridgeState {
    fn default() -> Self {
        Self::new()
    }
}

/// Install the global `mcp-response` listener. Each response carries a
/// `connection_id` and is routed to that connection's writer.
///
/// Event payload shape (JSON object string emitted by the webview):
/// ```json
/// { "connection_id": 3, "payload": "<raw JSON-RPC line, no trailing newline>" }
/// ```
pub fn install_response_listener(app: AppHandle, state: BridgeState) {
    let state_clone = state.clone();
    app.listen(RESPONSE_EVENT, move |event| {
        let raw = event.payload();
        // Tauri wraps event payloads as `{ "payload": <serialized> }`. Parse
        // both the wrapper and the inner shape.
        let inner_str: Option<String> = serde_json::from_str::<serde_json::Value>(raw)
            .ok()
            .and_then(|v| v.get("payload").and_then(|p| p.as_str()).map(String::from))
            .or_else(|| serde_json::from_str::<String>(raw).ok());
        let payload = match inner_str {
            Some(s) => s,
            None => return,
        };
        // Inner is itself a JSON object: { connection_id: u64, payload: string }
        let parsed: Option<(u64, String)> =
            serde_json::from_str::<serde_json::Value>(&payload)
                .ok()
                .and_then(|v| {
                    let id = v.get("connection_id")?.as_u64()?;
                    let line = v.get("payload")?.as_str()?.to_string();
                    Some((id, line))
                });
        let (connection_id, line) = match parsed {
            Some(t) => t,
            None => return,
        };
        // Route to the right connection. Drops silently if the connection
        // closed between dispatch and response (legitimate race).
        state_clone.send_to(connection_id, line);
    });
}

/// Bind the UDS and serve connections forever. Returns immediately after
/// spawning the task. Multiple connections are accepted concurrently — each
/// runs in its own tokio task.
#[cfg(unix)]
pub fn spawn(app: AppHandle, state: BridgeState) -> Result<(), String> {
    use tokio::net::UnixListener;

    let path = uds_path().ok_or_else(|| "failed to resolve UDS path".to_string())?;

    // Ensure parent directory exists.
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir {:?}: {e}", parent))?;
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
                    "[mcp-bridge] failed to bind {:?}: {e} (another gnar-term instance may be running)",
                    path_clone
                );
                return;
            }
        };
        if let Err(e) = set_socket_perms(&path_clone) {
            eprintln!("[mcp-bridge] failed to chmod {:?}: {e}", path_clone);
        }
        eprintln!("[mcp-bridge] listening on {:?}", path_clone);

        loop {
            let (stream, _) = match listener.accept().await {
                Ok(pair) => pair,
                Err(e) => {
                    eprintln!("[mcp-bridge] accept error: {e}");
                    continue;
                }
            };
            // Spawn each connection as an independent task — concurrent, not
            // serialized. Multi-agent scenarios depend on this.
            let app_for_conn = app_for_task.clone();
            let state_for_conn = state.clone();
            tauri::async_runtime::spawn(async move {
                handle_connection(stream, app_for_conn, state_for_conn).await;
            });
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
    // is unix-only; named-pipe fallback is a follow-up.
    Err("MCP bridge UDS not yet supported on this platform".to_string())
}

#[cfg(unix)]
async fn handle_connection(
    stream: tokio::net::UnixStream,
    app: AppHandle,
    state: BridgeState,
) {
    let connection_id = state.next_connection_id();
    let (read_half, mut write_half) = stream.into_split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    state.register(connection_id, tx.clone());

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

    // Read loop: one line per JSON-RPC message; emit as Tauri event with
    // connection_id metadata so the webview can route it.
    let mut reader = BufReader::new(read_half);
    let mut buf = String::new();
    loop {
        buf.clear();
        match reader.read_line(&mut buf).await {
            Ok(0) => break, // EOF
            Ok(_) => {
                let trimmed = buf.trim_end_matches(['\r', '\n']).to_string();
                if trimmed.is_empty() {
                    continue;
                }
                // Build the envelope: { connection_id, payload }
                // Use serde_json to be robust against arbitrary payload contents.
                let envelope = serde_json::json!({
                    "connection_id": connection_id,
                    "payload": trimmed,
                });
                let _ = app.emit(REQUEST_EVENT, envelope.to_string());
            }
            Err(_) => break,
        }
    }

    // Connection closed. Notify webview, free per-connection state, drain.
    state.unregister(connection_id);
    let close_envelope = serde_json::json!({ "connection_id": connection_id });
    let _ = app.emit(CONNECTION_CLOSED_EVENT, close_envelope.to_string());
    drop(tx);
    let _ = writer_task.await;
}

/// Run the `--mcp-stdio` byte pipe: open the UDS, send the gnar-term hello
/// notification carrying any pane/workspace context inherited from env vars,
/// then copy stdin ↔ socket ↔ stdout. Blocks until one side closes.
#[cfg(unix)]
pub fn run_stdio_shim() -> i32 {
    use tokio::io::{stdin, stdout};
    use tokio::net::UnixStream;

    let path = match uds_path() {
        Some(p) => p,
        None => {
            eprintln!("gnar-term: failed to resolve MCP socket path");
            return 1;
        }
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
                eprintln!(
                    "gnar-term is not running. Start gnar-term and try again. ({e})"
                );
                return 1;
            }
        };
        let (mut sock_r, mut sock_w) = stream.into_split();

        // Send the hello notification first so the GUI can bind this
        // connection to the agent's host pane/workspace.
        let hello = build_hello_message();
        if sock_w.write_all(hello.as_bytes()).await.is_err() {
            eprintln!("gnar-term: failed to send hello to GUI");
            return 1;
        }

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

/// Build the `$/gnar-term/hello` notification line (with trailing newline).
/// Reads `GNAR_TERM_PANE_ID` and `GNAR_TERM_WORKSPACE_ID` from env; both are
/// optional. Always sends a hello (even when unbound) so the GUI can record
/// the connection's binding state explicitly.
pub fn build_hello_message() -> String {
    let pane_id = std::env::var("GNAR_TERM_PANE_ID").ok();
    let workspace_id = std::env::var("GNAR_TERM_WORKSPACE_ID").ok();
    let client_pid = std::process::id();
    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "$/gnar-term/hello",
        "params": {
            "pane_id": pane_id,
            "workspace_id": workspace_id,
            "client_pid": client_pid,
        }
    });
    let mut s = payload.to_string();
    s.push('\n');
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uds_path_is_resolved() {
        let p = uds_path().expect("uds_path should resolve");
        let s = p.to_string_lossy();
        assert!(s.contains("gnar-term"), "uds path should contain gnar-term: {s}");
        assert!(s.ends_with("mcp.sock"), "uds path should end in mcp.sock: {s}");
    }

    #[test]
    fn hello_message_includes_env_vars() {
        // Use a separate process to control env without polluting other tests.
        // We test the function directly by setting env, then unsetting.
        std::env::set_var("GNAR_TERM_PANE_ID", "pane-abc");
        std::env::set_var("GNAR_TERM_WORKSPACE_ID", "ws-xyz");
        let line = build_hello_message();
        assert!(line.ends_with('\n'), "hello must terminate with newline");
        let parsed: serde_json::Value =
            serde_json::from_str(line.trim_end()).expect("hello must be valid JSON");
        assert_eq!(parsed["jsonrpc"], "2.0");
        assert_eq!(parsed["method"], "$/gnar-term/hello");
        assert_eq!(parsed["params"]["pane_id"], "pane-abc");
        assert_eq!(parsed["params"]["workspace_id"], "ws-xyz");
        assert!(parsed["params"]["client_pid"].is_number());
        assert!(parsed.get("id").is_none(), "hello is a notification, no id");
        std::env::remove_var("GNAR_TERM_PANE_ID");
        std::env::remove_var("GNAR_TERM_WORKSPACE_ID");
    }

    #[test]
    fn hello_message_when_unbound_uses_null() {
        // Ensure clean env.
        std::env::remove_var("GNAR_TERM_PANE_ID");
        std::env::remove_var("GNAR_TERM_WORKSPACE_ID");
        let line = build_hello_message();
        let parsed: serde_json::Value =
            serde_json::from_str(line.trim_end()).expect("valid JSON");
        assert!(parsed["params"]["pane_id"].is_null());
        assert!(parsed["params"]["workspace_id"].is_null());
        assert!(parsed["params"]["client_pid"].is_number());
    }

    #[test]
    fn connection_registry_isolates_writers() {
        let state = BridgeState::new();
        let (tx1, mut rx1) = mpsc::unbounded_channel::<String>();
        let (tx2, mut rx2) = mpsc::unbounded_channel::<String>();
        state.register(1, tx1);
        state.register(2, tx2);

        assert!(state.send_to(1, "to one".to_string()));
        assert!(state.send_to(2, "to two".to_string()));
        assert_eq!(rx1.try_recv().unwrap(), "to one");
        assert_eq!(rx2.try_recv().unwrap(), "to two");
        assert!(rx1.try_recv().is_err(), "conn 1 must not see conn 2's traffic");
        assert!(rx2.try_recv().is_err(), "conn 2 must not see conn 1's traffic");

        state.unregister(1);
        assert!(!state.send_to(1, "after close".to_string()));
        assert!(state.send_to(2, "still alive".to_string()));
        assert_eq!(rx2.try_recv().unwrap(), "still alive");
    }

    #[test]
    fn connection_ids_are_monotonic() {
        let state = BridgeState::new();
        let a = state.next_connection_id();
        let b = state.next_connection_id();
        let c = state.next_connection_id();
        assert!(b > a && c > b, "ids must be monotonic: {a} {b} {c}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn uds_two_concurrent_connections_each_round_trip() {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
        use tokio::net::{UnixListener, UnixStream};

        let dir = tempfile_dir();
        let path = dir.join("multi.sock");
        let _ = std::fs::remove_file(&path);
        let listener = match UnixListener::bind(&path) {
            Ok(l) => l,
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                eprintln!("[test] skipping multi-conn test: sandbox forbids bind ({e})");
                return;
            }
            Err(e) => panic!("bind: {e}"),
        };

        // Server: accept two connections concurrently. Each echoes the line
        // it receives, prefixed with its accept order.
        let server = tokio::spawn(async move {
            for i in 0..2u32 {
                let (stream, _) = listener.accept().await.unwrap();
                tokio::spawn(async move {
                    let (r, mut w) = stream.into_split();
                    let mut reader = BufReader::new(r);
                    let mut line = String::new();
                    reader.read_line(&mut line).await.unwrap();
                    let resp = format!("conn{} echoed: {}", i, line.trim());
                    w.write_all(resp.as_bytes()).await.unwrap();
                    w.write_all(b"\n").await.unwrap();
                    w.shutdown().await.unwrap();
                });
            }
        });

        // Two clients in parallel.
        let p1 = path.clone();
        let p2 = path.clone();
        let c1 = tokio::spawn(async move {
            let s = UnixStream::connect(&p1).await.unwrap();
            let (r, mut w) = s.into_split();
            w.write_all(b"hi-from-1\n").await.unwrap();
            w.shutdown().await.unwrap();
            let mut line = String::new();
            BufReader::new(r).read_line(&mut line).await.unwrap();
            line
        });
        let c2 = tokio::spawn(async move {
            let s = UnixStream::connect(&p2).await.unwrap();
            let (r, mut w) = s.into_split();
            w.write_all(b"hi-from-2\n").await.unwrap();
            w.shutdown().await.unwrap();
            let mut line = String::new();
            BufReader::new(r).read_line(&mut line).await.unwrap();
            line
        });

        let (r1, r2) = tokio::join!(c1, c2);
        let r1 = r1.unwrap();
        let r2 = r2.unwrap();
        // Both clients must receive a response that mentions their own input —
        // proving traffic was not cross-contaminated between connections.
        assert!(r1.contains("hi-from-1"), "client 1 must see its own message: {r1}");
        assert!(r2.contains("hi-from-2"), "client 2 must see its own message: {r2}");
        server.await.unwrap();
        let _ = std::fs::remove_file(&path);
    }

    #[cfg(unix)]
    fn tempfile_dir() -> std::path::PathBuf {
        let base = std::env::var("TMPDIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| std::env::temp_dir());
        let dir = base.join(format!("gnar-term-mcp-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }
}
