/**
 * MCP server wiring / lifecycle: subscribes to the Rust bridge events, routes
 * requests through `dispatch`, and emits responses. Also bridges pty-exit to
 * session status and publishes user-focus lifecycle events.
 */
import { get } from "svelte/store";
import { listen, emit } from "@tauri-apps/api/event";
import { activeWorkspace, activePane } from "../../stores/workspace";
import { unregisterMcpPty } from "../mcp-output-buffer";
import { pushEvent } from "../mcp-event-buffer";
import { getMcpSetting } from "../../config";
import { sessions, ptyToSession, connectionContexts, getOrCreateContext } from "./state";
import { dispatch } from "./transport";
import type { JsonRpcRequest } from "./types";

let initialized = false;

interface RequestEnvelope {
  connection_id: number;
  payload: string;
}

interface ConnectionClosedEnvelope {
  connection_id: number;
}

/** Initialize the MCP server. Honors the `mcp` config setting. */
export async function initMcpServer(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const setting = getMcpSetting();
  if (setting === "off") return;

  // Bridge pty-exit to session status updates.
  await listen<{ pty_id: number }>("pty-exit", (event) => {
    const sessionId = ptyToSession.get(event.payload.pty_id);
    if (!sessionId) return;
    const session = sessions.get(sessionId);
    if (session) {
      session.status = "exited";
      pushEvent({
        type: "session.statusChanged",
        sessionId,
        status: "exited",
      });
    }
    unregisterMcpPty(event.payload.pty_id);
    ptyToSession.delete(event.payload.pty_id);
  });

  await listen<string>("mcp-request", async (event) => {
    let envelope: RequestEnvelope;
    try {
      envelope = JSON.parse(event.payload) as RequestEnvelope;
    } catch {
      console.warn("[mcp] malformed request envelope:", event.payload);
      return;
    }
    if (
      typeof envelope.connection_id !== "number" ||
      typeof envelope.payload !== "string"
    ) {
      console.warn("[mcp] invalid request envelope shape:", envelope);
      return;
    }
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(envelope.payload) as JsonRpcRequest;
    } catch {
      console.warn("[mcp] malformed request payload:", envelope.payload);
      return;
    }
    const ctx = getOrCreateContext(envelope.connection_id);
    const resp = await dispatch(req, ctx);
    if (resp) {
      const out = {
        connection_id: envelope.connection_id,
        payload: JSON.stringify(resp),
      };
      await emit("mcp-response", JSON.stringify(out));
    }
  });

  await listen<string>("mcp-connection-closed", (event) => {
    let envelope: ConnectionClosedEnvelope;
    try {
      envelope = JSON.parse(event.payload) as ConnectionClosedEnvelope;
    } catch {
      console.warn("[mcp] malformed close envelope:", event.payload);
      return;
    }
    connectionContexts.delete(envelope.connection_id);
  });

  // Lifecycle events for user GUI focus changes (observers).
  let lastWorkspaceId: string | null = null;
  let lastPaneId: string | null = null;
  activeWorkspace.subscribe((ws) => {
    if (!ws) return;
    if (ws.id !== lastWorkspaceId) {
      lastWorkspaceId = ws.id;
      pushEvent({ type: "workspace.changed", workspaceId: ws.id });
    }
  });
  activePane.subscribe((pane) => {
    if (!pane) return;
    if (pane.id !== lastPaneId) {
      lastPaneId = pane.id;
      const ws = get(activeWorkspace);
      pushEvent({
        type: "pane.focused",
        paneId: pane.id,
        workspaceId: ws?.id ?? "",
      });
    }
  });
}

/** Reset the one-shot `initialized` guard so tests can re-init. */
export function resetInitializedForTest(): void {
  initialized = false;
}
