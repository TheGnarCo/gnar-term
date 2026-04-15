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

/// Spawn the bridge server as a background tokio task. Logs errors to stderr
/// but never panics — if the bridge fails to start, gnar-term keeps running
/// without it.
pub fn spawn(pty_map: PtyMap) {
    tokio::spawn(async move {
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
