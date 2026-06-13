/**
 * Shared mutable runtime state for the MCP server modules.
 *
 * Centralizing the session/connection maps here lets the tool handlers,
 * transport, and wiring layers all reference the same singletons without
 * importing one another (which would create cycles).
 */
import type { ConnectionContext, McpSession } from "./types";

// ---- Session state ----

export const sessions = new Map<string, McpSession>();
export const ptyToSession = new Map<number, string>();

/** Per-connection binding state. Keyed by connection_id from the bridge. */
export const connectionContexts = new Map<number, ConnectionContext>();

export function newSessionId(): string {
  return `mcp-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

export function getOrCreateContext(connectionId: number): ConnectionContext {
  let ctx = connectionContexts.get(connectionId);
  if (!ctx) {
    ctx = { connectionId, binding: null, lastSpawnedPaneId: null };
    connectionContexts.set(connectionId, ctx);
  }
  return ctx;
}
