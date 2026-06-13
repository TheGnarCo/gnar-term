/**
 * Gnar Term MCP server — runs in the Svelte webview and speaks JSON-RPC 2.0
 * over Tauri events to the Rust UDS bridge.
 *
 * Architecture (see Spacebase MCP spec § Connection binding):
 *
 * - The Rust bridge accepts multiple concurrent connections, assigns each a
 *   `connection_id`, and forwards `mcp-request` events as
 *   `{ connection_id, payload }`. Responses are emitted back the same way.
 * - The shim sends a `$/gnar-term/hello` notification on connect carrying
 *   the `pane_id` and `workspace_id` env vars it inherited. The webview
 *   stores the binding in a per-connection context map.
 * - UI-mutating tools resolve their target workspace/pane via `resolveTarget`
 *   which follows the spec's resolution rules deterministically (explicit args
 *   first, then connection binding, then **error** — never silently fall back
 *   to "active workspace"). The previous bug-class — panes following user GUI
 *   focus — is impossible because no write tool consults `activeWorkspace`.
 *
 * We hand-roll JSON-RPC 2.0 rather than pulling in `@modelcontextprotocol/sdk`
 * for two reasons: the SDK targets Node, and the surface area is tiny.
 *
 * This module is now a thin facade. The implementation is decomposed under
 * `./mcp/`:
 *   - `mcp/types.ts`             — shared types + constants
 *   - `mcp/state.ts`            — session / connection maps
 *   - `mcp/target-resolution.ts` — connection-binding → workspace/pane resolution
 *   - `mcp/dispatch-log.ts`      — observability dispatch log
 *   - `mcp/registry.ts`          — tool registry
 *   - `mcp/tools/*`              — individual tool handlers (self-register)
 *   - `mcp/transport.ts`         — JSON-RPC framing / dispatch
 *   - `mcp/session.ts`           — wiring / lifecycle (initMcpServer)
 *
 * Importing this module registers all tools (via `./mcp/tools`) and re-exports
 * the public + test surface so existing imports keep resolving unchanged.
 */
import "./mcp/tools";

import {
  sessions,
  ptyToSession,
  connectionContexts,
} from "./mcp/state";
import { resolveTarget } from "./mcp/target-resolution";
import { getTools } from "./mcp/registry";
import { resetDispatchLogForTest } from "./mcp/dispatch-log";
import { resetInitializedForTest } from "./mcp/session";
import type {
  ConnectionBinding,
  ConnectionContext,
  McpSession,
  ResolvedTarget,
  TargetArgs,
  ToolDef,
} from "./mcp/types";

// ---- Public API ----

export { dispatch } from "./mcp/transport";
export { initMcpServer } from "./mcp/session";
export { getDispatchLog } from "./mcp/dispatch-log";
export type { ConnectionBinding, ConnectionContext } from "./mcp/types";

// ---- Test hooks ----

export function _getToolsForTest(): ToolDef[] {
  return getTools();
}

export function _getSessionsForTest(): Map<string, McpSession> {
  return sessions;
}

export function _getConnectionContextsForTest(): Map<number, ConnectionContext> {
  return connectionContexts;
}

/** Build a connection context for tests. Pass binding=null for an unbound
 *  agent (will hit resolution rule 5); pass partial binding for the bound
 *  cases. The connectionId is auto-assigned to a synthetic value. */
export function _testContext(
  binding: Partial<ConnectionBinding> | null = null,
): ConnectionContext {
  const ctx: ConnectionContext = {
    connectionId: -1,
    binding: binding
      ? {
          paneId: binding.paneId ?? null,
          workspaceId: binding.workspaceId ?? null,
          clientPid: binding.clientPid ?? null,
        }
      : null,
    lastSpawnedPaneId: null,
  };
  return ctx;
}

/** Test-only wrapper that exposes resolveTarget for unit testing. */
export function _resolveTargetForTest(
  args: TargetArgs,
  ctx: ConnectionContext,
): ResolvedTarget {
  return resolveTarget(args, ctx);
}

export function _resetMcpServerForTest(): void {
  sessions.clear();
  ptyToSession.clear();
  connectionContexts.clear();
  resetDispatchLogForTest();
  resetInitializedForTest();
}
