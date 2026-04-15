//! Internal WebSocket bridge for in-process MCP integration.
//!
//! Hosts a localhost WebSocket server inside the gnar-term Rust backend so
//! external MCP sidecars (currently `packages/gnar-term-agent-mcp`) can drive
//! the app without owning state themselves.
//!
//! **Design: dumb proxy.** This module knows nothing about ops. It accepts a
//! WebSocket connection, parses `{ id, op, params }` envelopes, forwards each
//! request to the webview as a `bridge:request` Tauri event, and waits for a
//! `bridge:response` event back. All op handlers live in TypeScript in the
//! webview (`src/lib/services/bridge-handler.ts`). Adding a new op is a
//! TypeScript-only change — no Rust code changes required.
//!
//! The one thing Rust owns is correlation: each forwarded request gets a
//! `correlation_id` that the webview echoes back so concurrent requests from
//! multiple clients can be matched to their response.

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Listener};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use tokio_tungstenite::tungstenite::Message;

const DEFAULT_BRIDGE_PORT: u16 = 9876;
const REQUEST_TIMEOUT_SECS: u64 = 30;

static NEXT_CORRELATION_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Deserialize)]
struct BridgeRequest {
    id: String,
    op: String,
    #[serde(default)]
    params: serde_json::Value,
}

#[derive(Debug, Serialize, Clone)]
struct ForwardedRequest {
    correlation_id: u64,
    op: String,
    params: serde_json::Value,
}

#[derive(Debug, Deserialize, Clone)]
struct BridgeResponseFromWebview {
    correlation_id: u64,
    #[serde(default)]
    result: Option<serde_json::Value>,
    #[serde(default)]
    error: Option<String>,
}

type PendingMap = Arc<Mutex<HashMap<u64, oneshot::Sender<BridgeResponseFromWebview>>>>;

/// Spawn the bridge server as a background task on Tauri's async runtime.
/// Logs errors to stderr but never panics — if the bridge fails to start,
/// gnar-term keeps running without it.
pub fn spawn(app_handle: AppHandle) {
    let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));

    let pending_for_listener = pending.clone();
    app_handle.listen("bridge:response", move |event| {
        let payload = event.payload();
        let resp: BridgeResponseFromWebview = match serde_json::from_str(payload) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[gnar-term::internal_bridge] malformed webview response: {e}");
                return;
            }
        };
        let tx = {
            let mut map = match pending_for_listener.lock() {
                Ok(m) => m,
                Err(_) => return,
            };
            map.remove(&resp.correlation_id)
        };
        if let Some(tx) = tx {
            let _ = tx.send(resp);
        }
    });

    tauri::async_runtime::spawn(async move {
        if let Err(e) = run(app_handle, pending).await {
            eprintln!("[gnar-term::internal_bridge] server error: {e}");
        }
    });
}

async fn run(
    app_handle: AppHandle,
    pending: PendingMap,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let port: u16 = std::env::var("GNAR_TERM_BRIDGE_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEFAULT_BRIDGE_PORT);
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();

    let listener = TcpListener::bind(addr).await?;
    eprintln!("[gnar-term::internal_bridge] listening on ws://{addr}");

    loop {
        let (stream, peer) = listener.accept().await?;
        let app_handle = app_handle.clone();
        let pending = pending.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = handle_connection(stream, app_handle, pending).await {
                eprintln!("[gnar-term::internal_bridge] connection {peer} error: {e}");
            }
        });
    }
}

async fn handle_connection(
    stream: TcpStream,
    app_handle: AppHandle,
    pending: PendingMap,
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
            Ok(req) => forward(req, &app_handle, &pending).await,
            Err(e) => error_response("", &format!("malformed request: {e}")),
        };

        write.send(Message::Text(response)).await?;
    }

    Ok(())
}

async fn forward(req: BridgeRequest, app_handle: &AppHandle, pending: &PendingMap) -> String {
    let correlation_id = NEXT_CORRELATION_ID.fetch_add(1, Ordering::Relaxed);
    let client_id = req.id.clone();

    let (tx, rx) = oneshot::channel();
    if let Ok(mut map) = pending.lock() {
        map.insert(correlation_id, tx);
    } else {
        return error_response(&client_id, "pending map poisoned");
    }

    let forwarded = ForwardedRequest {
        correlation_id,
        op: req.op,
        params: req.params,
    };

    if let Err(e) = app_handle.emit("bridge:request", forwarded) {
        if let Ok(mut map) = pending.lock() {
            map.remove(&correlation_id);
        }
        return error_response(&client_id, &format!("failed to emit request: {e}"));
    }

    match tokio::time::timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS), rx).await {
        Ok(Ok(resp)) => {
            if let Some(err) = resp.error {
                error_response(&client_id, &err)
            } else {
                success_response(&client_id, resp.result.unwrap_or(serde_json::Value::Null))
            }
        }
        Ok(Err(_)) => error_response(&client_id, "response channel dropped"),
        Err(_) => {
            if let Ok(mut map) = pending.lock() {
                map.remove(&correlation_id);
            }
            error_response(
                &client_id,
                &format!("timeout after {REQUEST_TIMEOUT_SECS}s waiting for webview"),
            )
        }
    }
}

fn success_response(id: &str, result: serde_json::Value) -> String {
    serde_json::json!({ "id": id, "result": result }).to_string()
}

fn error_response(id: &str, error: &str) -> String {
    serde_json::json!({ "id": id, "error": error }).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn success_response_shape() {
        let json = success_response("req-1", serde_json::json!({ "pty_ids": [] }));
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["id"], "req-1");
        assert_eq!(parsed["result"]["pty_ids"], serde_json::json!([]));
    }

    #[test]
    fn error_response_shape() {
        let json = error_response("req-42", "something broke");
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["id"], "req-42");
        assert_eq!(parsed["error"], "something broke");
    }

    #[test]
    fn error_response_with_empty_id_for_malformed_requests() {
        let json = error_response("", "malformed request: expected value");
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["id"], "");
        assert!(parsed["error"].as_str().unwrap().starts_with("malformed"));
    }

    #[test]
    fn webview_response_deserializes_success() {
        let payload = r#"{"correlation_id":5,"result":{"ok":true}}"#;
        let resp: BridgeResponseFromWebview = serde_json::from_str(payload).unwrap();
        assert_eq!(resp.correlation_id, 5);
        assert_eq!(resp.result.unwrap(), serde_json::json!({ "ok": true }));
        assert!(resp.error.is_none());
    }

    #[test]
    fn webview_response_deserializes_error() {
        let payload = r#"{"correlation_id":7,"error":"unknown op: foo"}"#;
        let resp: BridgeResponseFromWebview = serde_json::from_str(payload).unwrap();
        assert_eq!(resp.correlation_id, 7);
        assert_eq!(resp.error.unwrap(), "unknown op: foo");
        assert!(resp.result.is_none());
    }

    #[test]
    fn correlation_ids_are_monotonic_and_unique() {
        let a = NEXT_CORRELATION_ID.fetch_add(1, Ordering::Relaxed);
        let b = NEXT_CORRELATION_ID.fetch_add(1, Ordering::Relaxed);
        let c = NEXT_CORRELATION_ID.fetch_add(1, Ordering::Relaxed);
        assert!(b > a);
        assert!(c > b);
    }
}
