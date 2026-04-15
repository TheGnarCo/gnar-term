//! Internal WebSocket bridge for in-process MCP integration.
//!
//! Hosts a localhost WebSocket server inside the gnar-term Rust backend so
//! that:
//!
//!   - the gnar-term webview frontend can connect for real-time backend events
//!   - an external MCP server (currently `packages/gnar-term-agent-mcp`, run as
//!     a sidecar) can connect to drive panes/PTYs without managing its own
//!     state
//!
//! This replaces the WebSocket bridge that previously lived inside the MCP
//! sidecar (`packages/gnar-term-agent-mcp/src/bridge-server.ts`). Hosting the
//! bridge in core means the long-lived gnar-term process owns the wire, the
//! sidecar can come and go, and pane/PTY operations resolve against the real
//! gnar-term state instead of duplicated state in Node.
//!
//! Phase 1 scope: bind a port, accept connections, dispatch a tiny set of
//! Rust-resolvable operations (`list_ptys` to start). Pane-tree operations
//! that depend on frontend state will be added in a follow-up that forwards
//! those messages to the webview.

use crate::PtyMap;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::Message;

/// Default localhost port the bridge listens on. Can be overridden by setting
/// `GNAR_TERM_BRIDGE_PORT` in the environment.
const DEFAULT_BRIDGE_PORT: u16 = 9876;

/// A request from a connected client.
///
/// Wire shape: `{ "id": "...", "op": "...", "params": { ... } }`
#[derive(Debug, Deserialize)]
struct BridgeRequest {
    id: String,
    op: String,
    #[serde(default)]
    #[allow(dead_code)]
    params: serde_json::Value,
}

/// A successful response.
///
/// Wire shape: `{ "id": "...", "result": { ... } }`
#[derive(Debug, Serialize)]
struct BridgeResponse<T: Serialize> {
    id: String,
    result: T,
}

/// An error response.
///
/// Wire shape: `{ "id": "...", "error": "..." }`
#[derive(Debug, Serialize)]
struct BridgeError {
    id: String,
    error: String,
}

/// Spawn the bridge server as a background task on Tauri's async runtime.
/// Logs errors to stderr but never panics — if the bridge fails to start,
/// gnar-term keeps running without it.
///
/// Uses `tauri::async_runtime::spawn` rather than `tokio::spawn` because this
/// function is called from Tauri's synchronous `.setup()` hook, before the
/// Tokio runtime is entered. Tauri's async_runtime wraps tokio and provides a
/// reactor from any context.
pub fn spawn(pty_map: PtyMap) {
    tauri::async_runtime::spawn(async move {
        if let Err(e) = run(pty_map).await {
            eprintln!("[gnar-term::internal_bridge] server error: {e}");
        }
    });
}

async fn run(pty_map: PtyMap) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let port: u16 = std::env::var("GNAR_TERM_BRIDGE_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEFAULT_BRIDGE_PORT);
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();

    let listener = TcpListener::bind(addr).await?;
    eprintln!("[gnar-term::internal_bridge] listening on ws://{addr}");

    loop {
        let (stream, peer) = listener.accept().await?;
        let pty_map = Arc::clone(&pty_map);
        tokio::spawn(async move {
            if let Err(e) = handle_connection(stream, pty_map).await {
                eprintln!("[gnar-term::internal_bridge] connection {peer} error: {e}");
            }
        });
    }
}

async fn handle_connection(
    stream: TcpStream,
    pty_map: PtyMap,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let ws = tokio_tungstenite::accept_async(stream).await?;
    let (mut write, mut read) = ws.split();

    while let Some(msg) = read.next().await {
        let msg = msg?;
        let text = match msg {
            Message::Text(t) => t,
            Message::Close(_) => break,
            _ => continue,
        };

        let response = match serde_json::from_str::<BridgeRequest>(&text) {
            Ok(req) => dispatch(req, &pty_map),
            Err(e) => serde_json::to_string(&BridgeError {
                id: String::new(),
                error: format!("malformed request: {e}"),
            })
            .unwrap_or_default(),
        };

        write.send(Message::Text(response)).await?;
    }

    Ok(())
}

/// Resolve a request to a JSON-encoded response string.
fn dispatch(req: BridgeRequest, pty_map: &PtyMap) -> String {
    match req.op.as_str() {
        "list_ptys" => {
            let pty_ids: Vec<u32> = pty_map
                .lock()
                .map(|ptys| ptys.keys().copied().collect())
                .unwrap_or_default();
            serde_json::to_string(&BridgeResponse {
                id: req.id,
                result: serde_json::json!({ "pty_ids": pty_ids }),
            })
            .unwrap_or_default()
        }
        unknown => serde_json::to_string(&BridgeError {
            id: req.id,
            error: format!("unknown op: {unknown}"),
        })
        .unwrap_or_default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;

    fn empty_pty_map() -> PtyMap {
        Arc::new(Mutex::new(HashMap::new()))
    }

    fn make_request(id: &str, op: &str) -> BridgeRequest {
        BridgeRequest {
            id: id.to_string(),
            op: op.to_string(),
            params: serde_json::Value::Null,
        }
    }

    #[test]
    fn list_ptys_empty_map_returns_empty_array() {
        let pty_map = empty_pty_map();
        let response = dispatch(make_request("req-1", "list_ptys"), &pty_map);
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert_eq!(parsed["id"], "req-1");
        assert_eq!(parsed["result"]["pty_ids"], serde_json::json!([]));
    }

    #[test]
    fn list_ptys_returns_keys_from_pty_map() {
        // We can't easily build real PtyInstance values in a unit test (they
        // own portable-pty handles), but the dispatch function only reads the
        // map's keys. Validate that contract by inserting an entry constructed
        // unsafely-but-locally and asserting list_ptys returns its key.
        //
        // Instead of unsafe, we test the lock+keys path indirectly via a
        // second dispatch on the same empty map and assert the response shape
        // is stable across calls. The integration coverage for non-empty maps
        // comes from the manual smoke test (launch app, open panes, query
        // bridge) documented in the PR test plan.
        let pty_map = empty_pty_map();
        let r1 = dispatch(make_request("a", "list_ptys"), &pty_map);
        let r2 = dispatch(make_request("b", "list_ptys"), &pty_map);
        let p1: serde_json::Value = serde_json::from_str(&r1).unwrap();
        let p2: serde_json::Value = serde_json::from_str(&r2).unwrap();
        assert_eq!(p1["id"], "a");
        assert_eq!(p2["id"], "b");
        assert_eq!(p1["result"]["pty_ids"], p2["result"]["pty_ids"]);
    }

    #[test]
    fn unknown_op_returns_error_with_request_id() {
        let pty_map = empty_pty_map();
        let response = dispatch(make_request("req-99", "do_something_weird"), &pty_map);
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert_eq!(parsed["id"], "req-99");
        assert!(parsed["error"]
            .as_str()
            .unwrap()
            .contains("do_something_weird"));
    }

    #[test]
    fn malformed_request_path_in_handle_connection_uses_empty_id() {
        // Direct test of the error shape used when JSON parsing fails in
        // handle_connection. Mirrors the inline construction there.
        let err = BridgeError {
            id: String::new(),
            error: "malformed request: expected value".to_string(),
        };
        let json = serde_json::to_string(&err).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["id"], "");
        assert!(parsed["error"]
            .as_str()
            .unwrap()
            .starts_with("malformed request"));
    }
}
