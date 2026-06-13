/**
 * Shared types and constants for the MCP server modules.
 *
 * This is a leaf module: it imports only type-level symbols and has no runtime
 * dependencies on stores or other MCP modules, so it can be imported anywhere
 * without risk of an import cycle.
 */
import type { Pane, Workspace } from "../../types";

// ---- Types ----

export type AgentType = "claude-code" | "codex" | "aider" | "custom";
export type SessionStatus = "starting" | "running" | "idle" | "exited";

export interface McpSession {
  session_id: string;
  name: string;
  agent: AgentType;
  pid: number | undefined;
  status: SessionStatus;
  cwd: string;
  createdAt: string;
  paneId: string;
  surfaceId: string;
  ptyId: number;
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: number | string | null;
  result: unknown;
}

export interface JsonRpcError {
  jsonrpc: "2.0";
  id: number | string | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

/** Per-connection state recorded from the `$/gnar-term/hello` handshake. */
export interface ConnectionBinding {
  paneId: string | null;
  workspaceId: string | null;
  clientPid: number | null;
}

export interface ConnectionContext {
  connectionId: number;
  binding: ConnectionBinding | null;
  /** Most-recent pane this connection spawned into. Used as the split host for
   *  the *next* spawn so rapid-fire `dispatch_tasks` produces a shallow
   *  right-chain instead of an N-deep left spine around the binding pane —
   *  the latter exploded `findParentSplit` + DOM render cost into O(N²). */
  lastSpawnedPaneId: string | null;
}

/** Sentinel for callers that have no transport context (test code calling
 *  dispatch directly, etc). Tools that require binding will error with the
 *  standard "agent has no pane/workspace context" message — exactly the same
 *  error path real unbound agents hit. */
export const ANONYMOUS_CONTEXT: ConnectionContext = {
  connectionId: 0,
  binding: null,
  lastSpawnedPaneId: null,
};

// ---- Agent command map ----

export const AGENT_COMMANDS: Record<AgentType, string | null> = {
  "claude-code": "claude",
  codex: "codex",
  aider: "aider",
  custom: null,
};

export const KEY_MAP: Record<string, string> = {
  "ctrl+c": "\x03",
  "ctrl+d": "\x04",
  "ctrl+z": "\x1a",
  "ctrl+l": "\x0c",
  "ctrl+a": "\x01",
  "ctrl+e": "\x05",
  "ctrl+u": "\x15",
  "ctrl+k": "\x0b",
  enter: "\r",
  tab: "\t",
  escape: "\x1b",
  backspace: "\x7f",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
};

/** Resolution result returned by `resolveTarget`. `hostPane` is non-null when
 *  the caller expressed a specific host pane to split; null means "place in
 *  the workspace's active pane (or first pane)." */
export interface ResolvedTarget {
  workspace: Workspace;
  hostPane: Pane | null;
  source:
    | "args-pane"
    | "args-workspace"
    | "binding-pane"
    | "binding-workspace";
}

export interface TargetArgs {
  workspace_id?: string;
  pane_id?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (
    args: Record<string, unknown>,
    ctx: ConnectionContext,
  ) => Promise<unknown> | unknown;
}
