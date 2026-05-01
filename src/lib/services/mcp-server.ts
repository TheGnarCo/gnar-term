/**
 * Gnar Term MCP server — runs in the Svelte webview and speaks JSON-RPC 2.0
 * over Tauri events to the Rust UDS bridge.
 *
 * # Architecture (see Spacebase MCP spec § Connection binding)
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
 * # Ideology: MCP mirrors the extension contribution points
 *
 * Extensions contribute capabilities by registering into core registries
 * (commands, surface types, sidebar tabs, workspace actions, …). Rather than
 * handcoding an MCP tool per extension, each contribution registry is
 * reflected as a generic `list_X` / `invoke_X` pair:
 *
 *   | Registry                | Tools                                        |
 *   | ----------------------- | -------------------------------------------- |
 *   | surface-type-registry   | list_surface_types, open_surface             |
 *   | command-registry        | list_commands, invoke_command                |
 *   | sidebar-tab-registry    | list_sidebar_tabs, activate_sidebar_tab      |
 *   | workspace-action-reg…   | list_workspace_actions, invoke_workspace_…   |
 *   | context-menu-item-reg…  | list_context_menu_items, invoke_context_…   |
 *
 * Adding an extension automatically increases MCP's surface area by its
 * contributions; adding an MCP tool never requires touching an extension.
 * MCP never imports from `src/extensions/*` — the extension barrier runs in
 * one direction (extensions depend on core) and MCP sits on the core side.
 *
 * If you catch yourself writing a tool named after a specific extension,
 * stop — that's the old pattern.
 */
import { get, writable } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import {
  nestedWorkspaces,
  activeWorkspace,
  activePane,
} from "../stores/nested-workspace";
import {
  getAllPanes,
  isTerminalSurface,
  uid,
  type Pane,
  type SplitNode,
  type TerminalSurface,
  type NestedWorkspace,
} from "../types";
import { findParentSplit } from "../types";
import {
  createTerminalSurface,
  waitForPtyReady,
  onFirstPtyOutput,
} from "../terminal-service";
import { safeFocus } from "./service-helpers";
import {
  registerMcpPty,
  unregisterMcpPty,
  getMcpBuffer,
} from "./mcp-output-buffer";
import { pushEvent } from "./mcp-event-buffer";
import {
  upsertSection,
  removeSection,
  type SidebarItem,
} from "../stores/mcp-sidebar";
import {
  openExtensionSurfaceInPaneById,
  createPreviewSurfaceInPane,
  focusSurfaceById,
  closeSurfaceById,
} from "./surface-service";
import {
  findPreviewSurfaceByPath,
  listPreviewSurfaces,
} from "./preview-surface-registry";
import { surfaceTypeStore } from "./surface-type-registry";
import { getWorkspaceStatus } from "./status-registry";
import { getMcpSetting } from "../config";
import { spawnAgentInWorktree } from "./spawn-helper";
import {
  type ConnectionBinding,
  type ConnectionContext,
  type ToolDef,
} from "./mcp-types";
export type { ConnectionBinding, ConnectionContext, ToolDef };
import { filesystemTools } from "./mcp-tools/filesystem";
import { registryMirrorTools } from "./mcp-tools/registry-mirrors";
import { introspectionTools } from "./mcp-tools/introspection";

// ---- Types ----

export type McpStatus = "live" | "error" | "disabled" | "pending";
const _mcpStatus = writable<McpStatus>("pending");
export const mcpStatus = { subscribe: _mcpStatus.subscribe };

type AgentType = "claude-code" | "codex" | "aider" | "custom";
type SessionStatus = "starting" | "exited";

interface McpSession {
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
  /** Cleanup for the first-PTY-output listener (if task is still pending). */
  unlisten?: () => void;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: unknown;
}

interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: number | string | null;
  result: unknown;
}

interface JsonRpcError {
  jsonrpc: "2.0";
  id: number | string | null;
  error: { code: number; message: string; data?: unknown };
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

/** Sentinel for callers that have no transport context (test code calling
 *  dispatch directly, etc). Tools that require binding will error with the
 *  standard "agent has no pane/workspace context" message — exactly the same
 *  error path real unbound agents hit. */
const ANONYMOUS_CONTEXT: ConnectionContext = {
  connectionId: 0,
  binding: null,
  lastSpawnedPaneId: null,
};

// ---- Agent command map ----

const AGENT_COMMANDS: Record<AgentType, string | null> = {
  "claude-code": "claude",
  codex: "codex",
  aider: "aider",
  custom: null,
};

const KEY_MAP: Record<string, string> = {
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

// ---- Session state ----

const sessions = new Map<string, McpSession>();
const ptyToSession = new Map<number, string>();

/** Per-connection binding state. Keyed by connection_id from the bridge. */
const connectionContexts = new Map<number, ConnectionContext>();

function newSessionId(): string {
  return `mcp-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

// ---- NestedWorkspace / pane resolution ----

function findPaneById(
  paneId: string,
): { workspace: NestedWorkspace; pane: Pane } | null {
  for (const ws of get(nestedWorkspaces)) {
    for (const pane of getAllPanes(ws.splitRoot)) {
      if (pane.id === paneId) return { workspace: ws, pane };
    }
  }
  return null;
}

function findWorkspaceById(workspaceId: string): NestedWorkspace | null {
  return get(nestedWorkspaces).find((w) => w.id === workspaceId) ?? null;
}

/** Resolution result returned by `resolveTarget`. `hostPane` is non-null when
 *  the caller expressed a specific host pane to split; null means "place in
 *  the workspace's active pane (or first pane)." */
interface ResolvedTarget {
  workspace: NestedWorkspace;
  hostPane: Pane | null;
  source: "args-pane" | "args-workspace" | "binding-pane" | "binding-workspace";
}

interface TargetArgs {
  workspace_id?: string;
  pane_id?: string;
}

/** Resolve which workspace (and optional host pane) a UI-mutating tool should
 *  target. Implements the resolution rules in the MCP spec § Connection binding.
 *  Throws with an actionable error message if no target can be resolved.
 *  Critically: this function NEVER reads `activeWorkspace`. User GUI focus is
 *  not an authoritative routing input. */
function resolveTarget(
  args: TargetArgs,
  ctx: ConnectionContext,
): ResolvedTarget {
  // Rule 1: explicit pane_id wins.
  if (args.pane_id) {
    const found = findPaneById(args.pane_id);
    if (!found) {
      throw new Error(
        `pane_id "${args.pane_id}" not found (it may have been closed)`,
      );
    }
    return {
      workspace: found.workspace,
      hostPane: found.pane,
      source: "args-pane",
    };
  }
  // Rule 2: explicit workspace_id.
  if (args.workspace_id) {
    const ws = findWorkspaceById(args.workspace_id);
    if (!ws) {
      throw new Error(`workspace_id "${args.workspace_id}" not found`);
    }
    return { workspace: ws, hostPane: null, source: "args-workspace" };
  }
  // Rule 3a: chain off the most recent pane this connection spawned, if any.
  // Keeps the split tree shallow under rapid-fire spawns — see the comment on
  // `ConnectionContext.lastSpawnedPaneId`.
  if (ctx.lastSpawnedPaneId) {
    const found = findPaneById(ctx.lastSpawnedPaneId);
    if (found) {
      return {
        workspace: found.workspace,
        hostPane: found.pane,
        source: "binding-pane",
      };
    }
    // Last pane was closed. Fall through.
  }
  // Rule 3b: connection-bound pane (re-derive workspace in case pane was moved).
  const binding = ctx.binding;
  if (binding?.paneId) {
    const found = findPaneById(binding.paneId);
    if (found) {
      return {
        workspace: found.workspace,
        hostPane: found.pane,
        source: "binding-pane",
      };
    }
    // Bound pane was closed. Fall through to rule 4 (workspace-only binding).
  }
  // Rule 4: connection-bound workspace.
  if (binding?.workspaceId) {
    const ws = findWorkspaceById(binding.workspaceId);
    if (ws) {
      return { workspace: ws, hostPane: null, source: "binding-workspace" };
    }
  }
  // Rule 5: no target. Error loudly — never fall back to active workspace.
  throw new Error(
    "agent has no pane/workspace context — pass workspace_id explicitly, or run the agent inside a gnar-term pane",
  );
}

/** Pick a host pane to split off when the caller didn't supply one. Prefers
 *  the workspace's active pane; falls back to the first pane in the tree. */
function pickHostPane(workspace: NestedWorkspace): Pane {
  const all = getAllPanes(workspace.splitRoot);
  if (workspace.activePaneId) {
    const active = all.find((p) => p.id === workspace.activePaneId);
    if (active) return active;
  }
  if (all.length > 0) return all[0]!;
  // NestedWorkspace exists but has no panes (shouldn't happen in practice; create one).
  const newPane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
  workspace.splitRoot = { type: "pane", pane: newPane };
  nestedWorkspaces.update((l) => [...l]);
  return newPane;
}

/** Split `hostPane` off into a new sibling pane within its workspace. */
function splitPaneInWorkspace(
  workspace: NestedWorkspace,
  hostPane: Pane,
  direction: "horizontal" | "vertical",
): Pane {
  const newPane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
  const newSplit: SplitNode = {
    type: "split",
    direction,
    children: [
      { type: "pane", pane: hostPane },
      { type: "pane", pane: newPane },
    ],
    ratio: 0.5,
  };
  if (
    workspace.splitRoot.type === "pane" &&
    workspace.splitRoot.pane.id === hostPane.id
  ) {
    workspace.splitRoot = newSplit;
  } else {
    const parentInfo = findParentSplit(workspace.splitRoot, hostPane.id);
    if (parentInfo && parentInfo.parent.type === "split") {
      parentInfo.parent.children[parentInfo.index] = newSplit;
    }
  }
  workspace.activePaneId = newPane.id;
  nestedWorkspaces.update((l) => [...l]);
  return newPane;
}

async function waitForPtyId(
  surface: TerminalSurface,
  timeoutMs = 5000,
): Promise<number> {
  return waitForPtyReady(surface, timeoutMs);
}

async function getPtyCwd(ptyId: number): Promise<string> {
  try {
    return await invoke<string>("get_pty_cwd", { ptyId });
  } catch {
    return "";
  }
}

function removeSurfaceFromPane(paneId: string, surfaceId: string): void {
  nestedWorkspaces.update((list) => {
    for (const ws of list) {
      for (const pane of getAllPanes(ws.splitRoot)) {
        if (pane.id !== paneId) continue;
        const idx = pane.surfaces.findIndex((s) => s.id === surfaceId);
        if (idx < 0) continue;
        const surface = pane.surfaces[idx]!;
        if (isTerminalSurface(surface)) {
          try {
            surface.terminal.dispose();
          } catch {
            /* ignore */
          }
        }
        pane.surfaces.splice(idx, 1);
        if (pane.surfaces.length === 0) {
          pane.activeSurfaceId = null;
        } else {
          pane.activeSurfaceId =
            pane.surfaces[Math.min(idx, pane.surfaces.length - 1)]!.id;
        }
      }
    }
    return [...list];
  });
}

// ---- Observability: dispatch log ----

interface DispatchLogEntry {
  ts: string;
  connectionId: number;
  tool: string;
  binding: ConnectionBinding | null;
  args: unknown;
  resolved?: { workspaceId: string; paneId: string | null; source: string };
  result?: { kind: "ok"; summary: string } | { kind: "error"; message: string };
}

const DISPATCH_LOG_MAX = 500;
const dispatchLog: DispatchLogEntry[] = [];

function logDispatch(entry: DispatchLogEntry): void {
  dispatchLog.push(entry);
  if (dispatchLog.length > DISPATCH_LOG_MAX) {
    dispatchLog.shift();
  }
  // Echo to console in a structured single line so devtools can grep.
  const resolved = entry.resolved
    ? `resolved={ws=${entry.resolved.workspaceId},pane=${entry.resolved.paneId ?? "-"},src=${entry.resolved.source}}`
    : "resolved=<unresolved>";
  const bind = entry.binding
    ? `binding={ws=${entry.binding.workspaceId ?? "null"},pane=${entry.binding.paneId ?? "null"}}`
    : "binding=<none>";
  const result = entry.result
    ? entry.result.kind === "ok"
      ? `result=ok(${entry.result.summary})`
      : `result=ERR(${entry.result.message})`
    : "result=<pending>";
  // eslint-disable-next-line no-console
  console.log(
    `[mcp] conn=#${entry.connectionId} tool=${entry.tool} ${bind} args=${JSON.stringify(entry.args)} ${resolved} ${result}`,
  );
}

export function _getDispatchLogForTest(): readonly DispatchLogEntry[] {
  return dispatchLog;
}

// ---- Tool definitions ----

const TOOLS: ToolDef[] = [];

function registerTool(t: ToolDef) {
  TOOLS.push(t);
}

/**
 * Register an MCP tool contributed by an extension. Extensions expand the
 * MCP surface with domain-specific tools they own. Tools registered here
 * are unregistered automatically when the extension deactivates via
 * unregisterMcpToolsBySource.
 *
 * Exposed indirectly to extensions through the ExtensionAPI.registerMcpTool
 * method in extension-api-ui.ts — extensions do not import this directly.
 *
 * Handler signature intentionally omits ConnectionContext; extensions
 * should not read or mutate per-connection state (that's reserved for
 * core tools that bind pane/workspace targets). If a future extension
 * genuinely needs connection context, promote the signature then, not
 * preemptively.
 */
export function registerExtensionMcpTool(
  source: string,
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown,
): void {
  TOOLS.push({ name, description, inputSchema, handler, source });
}

/** Cleanup: remove all tools contributed by a given extension id. */
export function unregisterMcpToolsBySource(source: string): void {
  for (let i = TOOLS.length - 1; i >= 0; i--) {
    const tool = TOOLS[i];
    if (tool && tool.source === source) TOOLS.splice(i, 1);
  }
}

// ---- Session management ----

registerTool({
  name: "spawn_agent",
  description:
    "Spawn a new gnar-term pane running an AI coding agent (claude-code, codex, aider) or a custom command. Targets the agent's host workspace by default (per connection binding); pass workspace_id/pane_id to override. Pass `worktree` to instead create a fresh worktree workspace and spawn the agent there (auto-resolves branch / worktree path; optionally tags the workspace under a dashboard).",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      agent: {
        type: "string",
        enum: ["claude-code", "codex", "aider", "custom"],
      },
      task: { type: "string" },
      cwd: { type: "string" },
      command: { type: "string" },
      env: { type: "object", additionalProperties: { type: "string" } },
      cols: { type: "number" },
      rows: { type: "number" },
      workspace_id: { type: "string" },
      pane_id: { type: "string" },
      worktree: {
        type: "object",
        description:
          "When set, spawn into a freshly-created worktree workspace instead of splitting the host pane.",
        properties: {
          branch: {
            type: "string",
            description:
              "Branch name. Default: agent/<agent>/<short-timestamp>.",
          },
          base: {
            type: "string",
            description: "Base branch. Default: main.",
          },
          repoPath: {
            type: "string",
            description:
              "Source repo path. Required if not in a workspace context.",
          },
          taskContext: {
            type: "string",
            description:
              "Optional free-text task description prepended to the agent's startup command (quoted as a single argument).",
          },
        },
      },
    },
    required: ["name", "agent"],
  },
  handler: async (args, ctx) => {
    const p = args as {
      name: string;
      agent: AgentType;
      task?: string;
      cwd?: string;
      command?: string;
      workspace_id?: string;
      pane_id?: string;
      worktree?: {
        branch?: string;
        base?: string;
        repoPath?: string;
        taskContext?: string;
      };
    };

    // --- Worktree path: spawn into a brand-new worktree workspace.
    if (p.worktree) {
      // Resolve repoPath from arg, else from the binding workspace's first
      // terminal cwd.
      let repoPath = p.worktree.repoPath?.trim() ?? "";
      if (!repoPath) {
        try {
          const target = resolveTarget(p, ctx);
          for (const pane of getAllPanes(target.workspace.splitRoot)) {
            for (const s of pane.surfaces) {
              if (isTerminalSurface(s) && s.cwd) {
                repoPath = s.cwd;
                break;
              }
            }
            if (repoPath) break;
          }
        } catch {
          // resolveTarget threw — surface the original "no repoPath" error.
        }
      }
      if (!repoPath) {
        throw new Error(
          "spawn_agent worktree: repoPath required (no workspace context to derive it from)",
        );
      }
      const result = await spawnAgentInWorktree({
        name: p.name,
        agent: p.agent,
        command: p.command,
        taskContext: p.worktree.taskContext,
        repoPath,
        ...(p.worktree.branch ? { branch: p.worktree.branch } : {}),
        ...(p.worktree.base ? { base: p.worktree.base } : {}),
      });
      ctx.lastSpawnedPaneId = result.pane_id;
      return result;
    }

    let startupCommand: string | undefined;
    if (p.agent === "custom") {
      if (!p.command)
        throw new Error('agent "custom" requires a command parameter');
      startupCommand = p.command;
    } else {
      const agentCmd = AGENT_COMMANDS[p.agent];
      if (!agentCmd) throw new Error(`unknown agent: ${p.agent}`);
      startupCommand = agentCmd;
    }

    const target = resolveTarget(p, ctx);
    const hostPane = target.hostPane ?? pickHostPane(target.workspace);
    const newPane = splitPaneInWorkspace(
      target.workspace,
      hostPane,
      "vertical",
    );
    ctx.lastSpawnedPaneId = newPane.id;

    const surface = await createTerminalSurface(newPane, p.cwd);
    surface.title = p.name;
    surface.startupCommand = startupCommand;
    newPane.activeSurfaceId = surface.id;
    nestedWorkspaces.update((l) => [...l]);
    void safeFocus(surface);

    const ptyId = await waitForPtyId(surface);
    registerMcpPty(ptyId);

    const cwd = p.cwd || (await getPtyCwd(ptyId));
    let pid: number | undefined;
    try {
      pid = await invoke<number>("get_pty_pid", { ptyId });
    } catch {
      pid = undefined;
    }

    const session: McpSession = {
      session_id: newSessionId(),
      name: p.name,
      agent: p.agent,
      pid,
      status: "starting",
      cwd,
      createdAt: new Date().toISOString(),
      paneId: newPane.id,
      surfaceId: surface.id,
      ptyId,
    };
    sessions.set(session.session_id, session);
    ptyToSession.set(ptyId, session.session_id);
    pushEvent({
      type: "pane.created",
      paneId: newPane.id,
      workspaceId: target.workspace.id,
    });
    pushEvent({
      type: "session.statusChanged",
      sessionId: session.session_id,
      status: "starting",
    });

    if (p.task) {
      const task = p.task;
      let safetyTimer: ReturnType<typeof setTimeout> | null = null;
      const unlisten = onFirstPtyOutput(ptyId, () => {
        if (safetyTimer !== null) {
          clearTimeout(safetyTimer);
          safetyTimer = null;
        }
        session.unlisten = undefined;
        invoke("write_pty", { ptyId, data: task + "\r" }).catch((err) =>
          console.warn(
            `[mcp] spawn_agent: task write failed for session ${session.session_id}:`,
            err,
          ),
        );
      });
      session.unlisten = unlisten;
      // Safety fallback: if no output arrives within 30s, cancel and warn.
      safetyTimer = setTimeout(() => {
        safetyTimer = null;
        unlisten();
        if (session.unlisten) session.unlisten = undefined;
        console.warn(
          `[mcp] spawn_agent: no PTY output within 30s for session ${session.session_id} — task not written`,
        );
      }, 30000);
    }

    return {
      session_id: session.session_id,
      name: session.name,
      agent: session.agent,
      pid: session.pid,
      status: session.status,
      cwd: session.cwd,
      pane_id: newPane.id,
      workspace_id: target.workspace.id,
    };
  },
});

registerTool({
  name: "split_pane",
  description:
    "Split a pane and open a surface in the new half. Defaults to a terminal split right. Returns the new pane_id.",
  inputSchema: {
    type: "object",
    properties: {
      direction: {
        type: "string",
        enum: ["horizontal", "vertical"],
        description:
          "Split direction: 'horizontal' = side-by-side, 'vertical' = stacked. Default: 'horizontal'.",
      },
      surface_type: {
        type: "string",
        enum: ["terminal", "preview"],
        description: "Surface to open in the new pane. Default: 'terminal'.",
      },
      preview_path: {
        type: "string",
        description:
          "Absolute path to the file to preview. Required when surface_type is 'preview'.",
      },
      workspace_id: { type: "string" },
      pane_id: { type: "string" },
    },
  },
  handler: async (args, ctx) => {
    const p = args as {
      direction?: "horizontal" | "vertical";
      surface_type?: "terminal" | "preview";
      preview_path?: string;
      workspace_id?: string;
      pane_id?: string;
    };
    if (p.surface_type === "preview" && !p.preview_path) {
      throw new Error(
        "preview_path is required when surface_type is 'preview'",
      );
    }
    const target = resolveTarget(p, ctx);
    const hostPane = target.hostPane ?? pickHostPane(target.workspace);
    const dir = p.direction === "vertical" ? "vertical" : "horizontal";
    const newPane = splitPaneInWorkspace(target.workspace, hostPane, dir);
    ctx.lastSpawnedPaneId = newPane.id;
    // split_pane is a lower-level primitive — it does not emit `pane.created`
    // because it does not spawn a tracked agent session. (Compare open_surface,
    // which also omits the event for the same reason.)

    if (p.surface_type === "preview") {
      const surface = createPreviewSurfaceInPane(newPane.id, p.preview_path!, {
        focus: true,
      });
      if (!surface) {
        throw new Error(`Could not open preview in new pane ${newPane.id}`);
      }
    } else {
      const surface = await createTerminalSurface(newPane);
      newPane.activeSurfaceId = surface.id;
      nestedWorkspaces.update((l) => [...l]);
      void safeFocus(surface);
    }

    return { pane_id: newPane.id, workspace_id: target.workspace.id };
  },
});

registerTool({
  name: "get_session_info",
  description: "Return metadata and buffer stats for an MCP session.",
  inputSchema: {
    type: "object",
    properties: { session_id: { type: "string" } },
    required: ["session_id"],
  },
  handler: (args) => {
    const { session_id } = args as { session_id: string };
    const session = sessions.get(session_id);
    if (!session) throw new Error(`session ${session_id} not found`);
    const buffer = getMcpBuffer(session.ptyId);
    return {
      session_id: session.session_id,
      name: session.name,
      agent: session.agent,
      pid: session.pid,
      status: session.status,
      cwd: session.cwd,
      createdAt: session.createdAt,
      bufferStats: buffer
        ? { cursor: buffer.getCursor(), lastLine: buffer.getLastLine() }
        : null,
    };
  },
});

registerTool({
  name: "kill_session",
  description: "Kill an MCP session and close its pane.",
  inputSchema: {
    type: "object",
    properties: {
      session_id: { type: "string" },
      signal: { type: "string" },
    },
    required: ["session_id"],
  },
  handler: async (args) => {
    const { session_id } = args as { session_id: string };
    const session = sessions.get(session_id);
    if (!session) throw new Error(`session ${session_id} not found`);
    // Cancel any pending first-output task listener before killing.
    if (session.unlisten) {
      session.unlisten();
      session.unlisten = undefined;
    }
    try {
      await invoke("kill_pty", { ptyId: session.ptyId });
    } catch (err) {
      console.warn("kill_pty failed:", err);
    }
    removeSurfaceFromPane(session.paneId, session.surfaceId);
    unregisterMcpPty(session.ptyId);
    ptyToSession.delete(session.ptyId);
    sessions.delete(session.session_id);
    pushEvent({
      type: "session.statusChanged",
      sessionId: session.session_id,
      status: "exited",
    });
    return { ok: true };
  },
});

// ---- Interaction ----

registerTool({
  name: "send_prompt",
  description:
    "Send text to an MCP session's PTY. Appends Enter unless press_enter is false.",
  inputSchema: {
    type: "object",
    properties: {
      session_id: { type: "string" },
      text: { type: "string" },
      press_enter: { type: "boolean" },
    },
    required: ["session_id", "text"],
  },
  handler: async (args) => {
    const p = args as {
      session_id: string;
      text: string;
      press_enter?: boolean;
    };
    const session = sessions.get(p.session_id);
    if (!session) throw new Error(`session ${p.session_id} not found`);
    const data = p.text + (p.press_enter === false ? "" : "\r");
    await invoke("write_pty", { ptyId: session.ptyId, data });
    return { ok: true };
  },
});

registerTool({
  name: "send_keys",
  description:
    "Send a named keystroke (ctrl+c, enter, escape, arrows, etc.) to an MCP session.",
  inputSchema: {
    type: "object",
    properties: {
      session_id: { type: "string" },
      keys: { type: "string" },
    },
    required: ["session_id", "keys"],
  },
  handler: async (args) => {
    const p = args as { session_id: string; keys: string };
    const session = sessions.get(p.session_id);
    if (!session) throw new Error(`session ${p.session_id} not found`);
    const sequence = KEY_MAP[p.keys.toLowerCase()];
    if (!sequence) {
      throw new Error(
        `unknown key "${p.keys}". Available: ${Object.keys(KEY_MAP).join(", ")}`,
      );
    }
    await invoke("write_pty", { ptyId: session.ptyId, data: sequence });
    return { ok: true };
  },
});

registerTool({
  name: "read_output",
  description:
    "Read terminal output from an MCP session. Supports cursor-based polling and ANSI stripping.",
  inputSchema: {
    type: "object",
    properties: {
      session_id: { type: "string" },
      lines: { type: "number" },
      cursor: { type: "number" },
      strip_ansi: { type: "boolean" },
    },
    required: ["session_id"],
  },
  handler: (args) => {
    const p = args as {
      session_id: string;
      lines?: number;
      cursor?: number;
      strip_ansi?: boolean;
    };
    const session = sessions.get(p.session_id);
    if (!session) throw new Error(`session ${p.session_id} not found`);
    const buffer = getMcpBuffer(session.ptyId);
    if (!buffer) {
      return {
        output: "",
        cursor: 0,
        total_lines: 0,
        session_status: session.status,
      };
    }
    const result = buffer.read({
      lines: p.lines,
      cursor: p.cursor,
      strip_ansi: p.strip_ansi,
    });
    return { ...result, session_status: session.status };
  },
});

// ---- Orchestration ----

registerTool({
  name: "dispatch_tasks",
  description:
    "Spawn multiple agent sessions sequentially. Each spawn inherits the pane context of the previous one via lastSpawnedPaneId to keep the split tree shallow. Pass workspace_id/pane_id per task to override the connection binding.",
  inputSchema: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            agent: { type: "string" },
            task: { type: "string" },
            cwd: { type: "string" },
            command: { type: "string" },
            workspace_id: { type: "string" },
            pane_id: { type: "string" },
          },
          required: ["name", "agent", "task"],
        },
      },
    },
    required: ["tasks"],
  },
  handler: async (args, ctx) => {
    const { tasks } = args as {
      tasks: Array<{
        name: string;
        agent: AgentType;
        task: string;
        cwd?: string;
        command?: string;
        workspace_id?: string;
        pane_id?: string;
      }>;
    };
    const results: Array<{
      session_id: string;
      name: string;
      agent: AgentType;
      pid: number | undefined;
      pane_id?: string;
      workspace_id?: string;
      error?: string;
    }> = [];
    const spawnTool = TOOLS.find((t) => t.name === "spawn_agent")!;
    for (const taskDef of tasks) {
      try {
        const resp = (await spawnTool.handler(
          {
            name: taskDef.name,
            agent: taskDef.agent,
            task: taskDef.task,
            cwd: taskDef.cwd,
            command: taskDef.command,
            workspace_id: taskDef.workspace_id,
            pane_id: taskDef.pane_id,
          },
          ctx,
        )) as {
          session_id: string;
          name: string;
          agent: AgentType;
          pid: number | undefined;
          pane_id: string;
          workspace_id: string;
        };
        results.push({
          session_id: resp.session_id,
          name: resp.name,
          agent: resp.agent,
          pid: resp.pid,
          pane_id: resp.pane_id,
          workspace_id: resp.workspace_id,
        });
      } catch (err) {
        results.push({
          session_id: "",
          name: taskDef.name,
          agent: taskDef.agent,
          pid: undefined,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return {
      dispatched: results.filter((r) => !r.error).length,
      failed: results.filter((r) => r.error).length,
      sessions: results,
    };
  },
});

// ---- UI writes ----

registerTool({
  name: "render_sidebar",
  description:
    "Declare or replace an extension sidebar section in the resolved workspace. Sections are workspace-scoped: invisible from other nestedWorkspaces.",
  inputSchema: {
    type: "object",
    properties: {
      side: { type: "string", enum: ["primary", "secondary"] },
      section_id: { type: "string" },
      title: { type: "string" },
      items: { type: "array" },
      workspace_id: { type: "string" },
    },
    required: ["side", "section_id", "title", "items"],
  },
  handler: (args, ctx) => {
    const p = args as {
      side: "primary" | "secondary";
      section_id: string;
      title: string;
      items: SidebarItem[];
      workspace_id?: string;
    };
    const target = resolveTarget({ workspace_id: p.workspace_id }, ctx);
    upsertSection({
      side: p.side,
      sectionId: p.section_id,
      title: p.title,
      items: p.items ?? [],
      workspaceId: target.workspace.id,
    });
    return { ok: true, workspace_id: target.workspace.id };
  },
});

registerTool({
  name: "remove_sidebar_section",
  description:
    "Remove an extension-declared sidebar section from the resolved workspace. Safe for non-existent IDs.",
  inputSchema: {
    type: "object",
    properties: {
      side: { type: "string", enum: ["primary", "secondary"] },
      section_id: { type: "string" },
      workspace_id: { type: "string" },
    },
    required: ["side", "section_id"],
  },
  handler: (args, ctx) => {
    const p = args as {
      side: "primary" | "secondary";
      section_id: string;
      workspace_id?: string;
    };
    const target = resolveTarget({ workspace_id: p.workspace_id }, ctx);
    removeSection(target.workspace.id, p.side, p.section_id);
    return { ok: true, workspace_id: target.workspace.id };
  },
});

// ---- Generic surface-type discovery + open ----
//
// Extensions register surface types at runtime using an
// `<extension-id>:<surface-id>` namespace. Agents can discover what's
// available via list_surface_types and open any of them via open_surface.
// MCP stays agnostic to which extensions exist — no extension id or
// surface id is hard-coded here.

registerTool({
  name: "open_surface",
  description:
    "Open any registered extension surface type in a pane. Call list_surface_types first to see which ids exist; props are forwarded to the owning extension's surface component unchanged — consult that extension for the expected prop shape. Targets the agent's host workspace by default; pass workspace_id/pane_id to override.",
  inputSchema: {
    type: "object",
    properties: {
      surface_type_id: {
        type: "string",
        description:
          "Surface type id as returned by list_surface_types (format: `<extension-id>:<surface-id>`).",
      },
      title: { type: "string" },
      props: {
        type: "object",
        additionalProperties: true,
        description: "Opaque props object forwarded to the surface component.",
      },
      placement: {
        type: "string",
        enum: ["split-right", "split-down", "new-tab", "current-pane"],
      },
      workspace_id: { type: "string" },
      pane_id: { type: "string" },
    },
    required: ["surface_type_id", "title"],
  },
  handler: (args, ctx) => {
    const p = args as {
      surface_type_id: string;
      title: string;
      props?: Record<string, unknown>;
      placement?: "split-right" | "split-down" | "new-tab" | "current-pane";
      workspace_id?: string;
      pane_id?: string;
    };
    const typeDef = get(surfaceTypeStore).find(
      (t) => t.id === p.surface_type_id,
    );
    if (!typeDef) {
      throw new Error(
        `Unknown surface type: ${p.surface_type_id}. Call list_surface_types to see what's registered.`,
      );
    }
    const target = resolveTarget(p, ctx);
    const placement = p.placement ?? "split-right";
    const hostPane = target.hostPane ?? pickHostPane(target.workspace);
    let targetPane: Pane;
    if (placement === "split-right") {
      targetPane = splitPaneInWorkspace(
        target.workspace,
        hostPane,
        "horizontal",
      );
      ctx.lastSpawnedPaneId = targetPane.id;
    } else if (placement === "split-down") {
      targetPane = splitPaneInWorkspace(target.workspace, hostPane, "vertical");
      ctx.lastSpawnedPaneId = targetPane.id;
    } else {
      targetPane = hostPane;
    }
    const result = openExtensionSurfaceInPaneById(
      targetPane.id,
      p.surface_type_id,
      p.title,
      p.props,
    );
    if (!result) {
      throw new Error("Could not place surface in a pane");
    }
    return {
      surface_id: result.surfaceId,
      pane_id: result.paneId,
      workspace_id: target.workspace.id,
    };
  },
});

// ---- Status items (mirror of statusRegistry, scoped per workspace) ----

registerTool({
  name: "get_status_for_workspace",
  description:
    "List structured status items contributed by extensions for a workspace (e.g. git branch, agent-running badge). Returns `{ items }` with each item carrying `{ id, source, category, priority, label, icon?, tooltip?, variant? }`. Sorted by priority ascending. Defaults to the agent's bound workspace; pass workspace_id to override.",
  inputSchema: {
    type: "object",
    properties: {
      workspace_id: { type: "string" },
    },
  },
  handler: (args, ctx) => {
    const p = args as { workspace_id?: string };
    const target = resolveTarget({ workspace_id: p.workspace_id }, ctx);
    const items = get(getWorkspaceStatus(target.workspace.id)).map((i) => ({
      id: i.id,
      source: i.source,
      category: i.category,
      priority: i.priority,
      label: i.label,
      icon: i.icon,
      tooltip: i.tooltip,
      variant: i.variant,
    }));
    return { workspace_id: target.workspace.id, items };
  },
});

// ---- Agent introspection ----

registerTool({
  name: "get_agent_context",
  description:
    "Return the connection's bound {pane_id, workspace_id, client_pid} from the $/gnar-term/hello handshake. All fields are null when the agent is unbound (was not run inside a gnar-term pane). Agents should call this once on startup to learn their context.",
  inputSchema: { type: "object", properties: {} },
  handler: (_args, ctx) => {
    const b = ctx.binding;
    return {
      pane_id: b?.paneId ?? null,
      workspace_id: b?.workspaceId ?? null,
      client_pid: b?.clientPid ?? null,
    };
  },
});

// ---- Preview surfaces ----

registerTool({
  name: "spawn_preview",
  description:
    "Open a file as a preview surface in a pane. Markdown files render with gnar:<name> markdown-components as live widgets. If a preview surface for the same path is already open anywhere in the app, focuses it instead of opening a duplicate. Returns the new (or existing) surface id. IMPORTANT: the file must already exist on disk before calling this — call write_file first, or use create_preview_file which does both atomically.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute path to the file to preview.",
      },
      workspace_id: {
        type: "string",
        description:
          "Optional override; defaults to the agent's host workspace.",
      },
      pane_id: {
        type: "string",
        description:
          "Optional override; defaults to the agent's host pane (or the workspace's primary pane if no host context).",
      },
      focus: {
        type: "boolean",
        description: "Whether to focus the new surface. Default true.",
      },
    },
    required: ["path"],
  },
  handler: (args, ctx) => {
    const p = args as {
      path: string;
      workspace_id?: string;
      pane_id?: string;
      focus?: boolean;
    };
    // Dedupe across the entire app — preview surfaces are unique by path.
    const existing = findPreviewSurfaceByPath(p.path);
    if (existing) {
      if (p.focus !== false) focusSurfaceById(existing.surfaceId);
      return {
        surface_id: existing.surfaceId,
        pane_id: existing.paneId,
        workspace_id: existing.workspaceId,
        reused: true,
      };
    }
    const target = resolveTarget(p, ctx);
    const hostPane = target.hostPane ?? pickHostPane(target.workspace);
    const surface = createPreviewSurfaceInPane(hostPane.id, p.path, {
      focus: p.focus !== false,
    });
    if (!surface) {
      throw new Error(
        `Could not place preview surface in pane ${hostPane.id} (workspace ${target.workspace.id})`,
      );
    }
    return {
      surface_id: surface.id,
      pane_id: hostPane.id,
      workspace_id: target.workspace.id,
      reused: false,
    };
  },
});

registerTool({
  name: "create_preview_file",
  description:
    "Write a file with the given content and immediately open it as a preview surface. Writes the file first, then opens the preview — never the other way around. Equivalent to write_file followed by spawn_preview, with the same dedupe-by-path behavior. For ad-hoc documents (notes, reports, one-off previews), default the path to docs/gnar-term/<name>.md unless the user specifies otherwise.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
      workspace_id: { type: "string" },
      pane_id: { type: "string" },
      focus: { type: "boolean" },
    },
    required: ["path", "content"],
  },
  handler: async (args, ctx) => {
    const p = args as {
      path: string;
      content: string;
      workspace_id?: string;
      pane_id?: string;
      focus?: boolean;
    };
    await invoke("write_file", { path: p.path, content: p.content });
    const spawn = TOOLS.find((t) => t.name === "spawn_preview")!;
    return spawn.handler(
      {
        path: p.path,
        workspace_id: p.workspace_id,
        pane_id: p.pane_id,
        focus: p.focus,
      },
      ctx,
    );
  },
});

registerTool({
  name: "close_preview",
  description:
    "Close an open preview surface by id. Looks the surface up in the preview-surface registry and removes it from its host pane (collapsing the pane / closing the workspace if it becomes empty, same as a user-driven tab close). Safe to call for an unknown id — returns `{ closed: false }`.",
  inputSchema: {
    type: "object",
    properties: {
      surface_id: {
        type: "string",
        description: "Id of the preview surface to close.",
      },
    },
    required: ["surface_id"],
  },
  handler: (args) => {
    const p = args as { surface_id: string };
    const entry = listPreviewSurfaces().find(
      (e) => e.surfaceId === p.surface_id,
    );
    if (!entry) return { closed: false };
    closeSurfaceById(entry.paneId, entry.surfaceId);
    return { closed: true };
  },
});

// ---- Push extracted tool groups into TOOLS ----

for (const t of [
  ...filesystemTools,
  ...registryMirrorTools,
  ...introspectionTools,
]) {
  TOOLS.push(t);
}

// ---- JSON-RPC dispatch ----

const PROTOCOL_VERSION = "2025-11-25";
const SERVER_INFO = { name: "gnar-term", version: "0.3.1" };

/** Tools that mutate UI surfaces — these are the ones that get logged to
 *  dispatchLog with binding/resolution metadata. */
const UI_MUTATING_TOOLS = new Set([
  "spawn_agent",
  "dispatch_tasks",
  "open_surface",
  "render_sidebar",
  "remove_sidebar_section",
  "spawn_preview",
  "create_preview_file",
  "close_preview",
  "add_dashboard_to_workspace",
  "remove_dashboard_from_workspace",
]);

export async function dispatch(
  req: JsonRpcRequest,
  ctx: ConnectionContext = ANONYMOUS_CONTEXT,
): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;
  const isNotification = req.id === undefined || req.id === null;

  try {
    switch (req.method) {
      case "initialize": {
        const result = {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
        };
        return isNotification ? null : { jsonrpc: "2.0", id, result };
      }
      case "$/gnar-term/hello": {
        // Connection-binding handshake. Always a notification (no id).
        const params = (req.params ?? {}) as {
          pane_id?: string | null;
          workspace_id?: string | null;
          client_pid?: number | null;
        };
        ctx.binding = {
          paneId: params.pane_id ?? null,
          workspaceId: params.workspace_id ?? null,
          clientPid: params.client_pid ?? null,
        };
        return null;
      }
      case "notifications/initialized":
      case "initialized":
        return null;
      case "tools/list": {
        const tools = TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }));
        return isNotification
          ? null
          : { jsonrpc: "2.0", id, result: { tools } };
      }
      case "tools/call": {
        const params = (req.params ?? {}) as {
          name: string;
          arguments?: Record<string, unknown>;
        };
        const tool = TOOLS.find((t) => t.name === params.name);
        if (!tool) {
          if (isNotification) return null;
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `unknown tool: ${params.name}` },
          };
        }
        const args = params.arguments ?? {};
        const shouldLog = UI_MUTATING_TOOLS.has(tool.name);
        const logEntry: DispatchLogEntry | null = shouldLog
          ? {
              ts: new Date().toISOString(),
              connectionId: ctx.connectionId,
              tool: tool.name,
              binding: ctx.binding,
              args,
            }
          : null;
        try {
          const value = await tool.handler(args, ctx);
          if (logEntry) {
            // Try to surface the resolution metadata when the result includes it.
            const v = value as
              | { workspace_id?: string; pane_id?: string }
              | undefined
              | null;
            if (v && v.workspace_id) {
              logEntry.resolved = {
                workspaceId: v.workspace_id,
                paneId: v.pane_id ?? null,
                source: "tool-result",
              };
            }
            logEntry.result = {
              kind: "ok",
              summary: JSON.stringify(value).slice(0, 120),
            };
            logDispatch(logEntry);
          }
          if (isNotification) return null;
          // MCP spec requires `structuredContent` to be a JSON object (record).
          // Arrays, null, and primitives are rejected by client-side Zod
          // validators, so only attach structuredContent when the tool returned
          // a plain object. Text `content` still carries the full JSON payload.
          const isRecord =
            value !== null &&
            typeof value === "object" &&
            !Array.isArray(value);
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: JSON.stringify(value) }],
              ...(isRecord ? { structuredContent: value } : {}),
            },
          };
        } catch (err) {
          if (logEntry) {
            logEntry.result = {
              kind: "error",
              message: err instanceof Error ? err.message : String(err),
            };
            logDispatch(logEntry);
          }
          throw err;
        }
      }
      case "ping":
        return isNotification ? null : { jsonrpc: "2.0", id, result: {} };
      default:
        if (isNotification) return null;
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `method not found: ${req.method}` },
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isNotification) {
      console.warn("[mcp] notification handler threw:", message);
      return null;
    }
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32000, message },
    };
  }
}

// ---- Wiring ----

let initialized = false;

interface RequestEnvelope {
  connection_id: number;
  payload: string;
}

interface ConnectionClosedEnvelope {
  connection_id: number;
}

function getOrCreateContext(connectionId: number): ConnectionContext {
  let ctx = connectionContexts.get(connectionId);
  if (!ctx) {
    ctx = { connectionId, binding: null, lastSpawnedPaneId: null };
    connectionContexts.set(connectionId, ctx);
  }
  return ctx;
}

/** Initialize the MCP server. Honors the `mcp` config setting. */
export async function initMcpServer(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const setting = getMcpSetting();
  if (setting === "off") {
    _mcpStatus.set("disabled");
    return;
  }

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

  _mcpStatus.set("live");

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

// ---- Test hooks ----

export function _getToolsForTest(): ToolDef[] {
  return TOOLS;
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

export function _getSessionsForTest(): Map<string, McpSession> {
  return sessions;
}

export function _resetMcpServerForTest(): void {
  sessions.clear();
  ptyToSession.clear();
  connectionContexts.clear();
  dispatchLog.length = 0;
  initialized = false;
}
