/**
 * Gnar Term MCP server — runs in the Svelte webview and speaks JSON-RPC 2.0
 * over Tauri events to the Rust UDS bridge.
 *
 * Design note (2026-04-15): We hand-roll JSON-RPC 2.0 rather than pulling in
 * @modelcontextprotocol/sdk. The SDK isn't in package.json, the bundler
 * target is a Chromium/WebKit webview (not node), and the required surface
 * area is tiny: initialize, tools/list, tools/call, and MCP notifications.
 * Hand-rolling keeps the module ~500 LOC and sidesteps Node/ESM polyfills.
 *
 * Rust emits `mcp-request` with `{ payload: <raw json-rpc string> }`. The
 * server dispatches and emits `mcp-response` with the same shape. Clients are
 * responsible for their own request ordering.
 */
import { get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import {
  workspaces,
  activeWorkspace,
  activePane,
} from "../stores/workspace";
import {
  getAllPanes,
  getAllSurfaces,
  isTerminalSurface,
  uid,
  type Pane,
  type SplitNode,
  type Surface,
  type TerminalSurface,
} from "../types";
import { findParentSplit } from "../types";
import { createTerminalSurface } from "../terminal-service";
import { createWorkspace } from "./workspace-service";
import { safeFocus } from "./service-helpers";
import {
  registerMcpPty,
  unregisterMcpPty,
  getMcpBuffer,
} from "./mcp-output-buffer";
import { pushEvent, pollEvents } from "./mcp-event-buffer";
import {
  upsertSection,
  removeSection,
  type SidebarItem,
} from "../stores/extension-sidebar";
import { openPreviewFromContent } from "../../preview";
import { getMcpSetting } from "../config";

// ---- Types ----

type AgentType = "claude-code" | "codex" | "aider" | "custom";
type SessionStatus = "starting" | "running" | "idle" | "exited";

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

function newSessionId(): string {
  return `mcp-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

// ---- Pane helpers (same semantics as the old bridge client) ----

function getOrCreateActivePane(): Pane {
  let ws = get(activeWorkspace);
  if (!ws) {
    createWorkspace("MCP");
    ws = get(activeWorkspace)!;
  }
  const existingActive = get(activePane);
  if (existingActive) return existingActive;
  const panes = getAllPanes(ws.splitRoot);
  if (panes.length > 0) return panes[0];
  const newPane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
  ws.splitRoot = { type: "pane", pane: newPane };
  workspaces.update((l) => [...l]);
  return newPane;
}

function splitActivePane(direction: "horizontal" | "vertical"): Pane {
  const wsVal = get(activeWorkspace);
  if (!wsVal) createWorkspace("MCP");
  const workspace = get(activeWorkspace)!;
  const currentActive = get(activePane) ?? getAllPanes(workspace.splitRoot)[0];
  if (!currentActive) return getOrCreateActivePane();
  const newPane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
  const newSplit: SplitNode = {
    type: "split",
    direction,
    children: [
      { type: "pane", pane: currentActive },
      { type: "pane", pane: newPane },
    ],
    ratio: 0.5,
  };
  if (
    workspace.splitRoot.type === "pane" &&
    workspace.splitRoot.pane.id === currentActive.id
  ) {
    workspace.splitRoot = newSplit;
  } else {
    const parentInfo = findParentSplit(workspace.splitRoot, currentActive.id);
    if (parentInfo && parentInfo.parent.type === "split") {
      parentInfo.parent.children[parentInfo.index] = newSplit;
    }
  }
  workspace.activePaneId = newPane.id;
  workspaces.update((l) => [...l]);
  return newPane;
}

async function waitForPtyId(
  surface: TerminalSurface,
  timeoutMs = 5000,
): Promise<number> {
  const start = Date.now();
  while (surface.ptyId < 0) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("timed out waiting for PTY to spawn");
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return surface.ptyId;
}

async function getPtyCwd(ptyId: number): Promise<string> {
  try {
    return await invoke<string>("get_pty_cwd", { ptyId });
  } catch {
    return "";
  }
}

function removeSurfaceFromPane(paneId: string, surfaceId: string): void {
  workspaces.update((list) => {
    for (const ws of list) {
      for (const pane of getAllPanes(ws.splitRoot)) {
        if (pane.id !== paneId) continue;
        const idx = pane.surfaces.findIndex((s) => s.id === surfaceId);
        if (idx < 0) continue;
        const surface = pane.surfaces[idx];
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
            pane.surfaces[Math.min(idx, pane.surfaces.length - 1)].id;
        }
      }
    }
    return [...list];
  });
}

function reapDeadSessions(): void {
  const aliveSurfaceIds = new Set<string>();
  for (const ws of get(workspaces)) {
    for (const surface of getAllSurfaces(ws)) {
      aliveSurfaceIds.add(surface.id);
    }
  }
  for (const [id, session] of sessions) {
    if (!aliveSurfaceIds.has(session.surfaceId)) {
      unregisterMcpPty(session.ptyId);
      ptyToSession.delete(session.ptyId);
      sessions.delete(id);
    }
  }
}

// ---- Workspace introspection helpers ----

function describeSurface(s: Surface) {
  return {
    id: s.id,
    kind: s.kind,
    title: s.title,
  };
}

function describePane(pane: Pane, workspaceId: string) {
  const activeSurface = pane.surfaces.find((s) => s.id === pane.activeSurfaceId);
  let cwd = "";
  if (activeSurface && isTerminalSurface(activeSurface)) {
    cwd = activeSurface.cwd ?? "";
  }
  return {
    id: pane.id,
    workspaceId,
    cwd,
    activeSurfaceId: pane.activeSurfaceId,
    surfaces: pane.surfaces.map(describeSurface),
  };
}

// ---- Tool definitions ----

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

const TOOLS: ToolDef[] = [];

function registerTool(t: ToolDef) {
  TOOLS.push(t);
}

// ---- Session management ----

registerTool({
  name: "spawn_agent",
  description:
    "Spawn a new gnar-term pane running an AI coding agent (claude-code, codex, aider) or a custom command.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      agent: { type: "string", enum: ["claude-code", "codex", "aider", "custom"] },
      task: { type: "string" },
      cwd: { type: "string" },
      command: { type: "string" },
      env: { type: "object", additionalProperties: { type: "string" } },
      cols: { type: "number" },
      rows: { type: "number" },
    },
    required: ["name", "agent"],
  },
  handler: async (args) => {
    const p = args as {
      name: string;
      agent: AgentType;
      task?: string;
      cwd?: string;
      command?: string;
    };
    let startupCommand: string | undefined;
    if (p.agent === "custom") {
      if (!p.command) {
        throw new Error('agent "custom" requires a command parameter');
      }
      startupCommand = p.command;
    } else {
      const agentCmd = AGENT_COMMANDS[p.agent];
      if (!agentCmd) throw new Error(`unknown agent: ${p.agent}`);
      startupCommand = agentCmd;
    }

    const existingActive = get(activePane);
    const target = existingActive ? splitActivePane("vertical") : getOrCreateActivePane();

    const surface = await createTerminalSurface(target, p.cwd);
    surface.title = p.name;
    surface.startupCommand = startupCommand;
    target.activeSurfaceId = surface.id;
    workspaces.update((l) => [...l]);
    safeFocus(surface);

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
      paneId: target.id,
      surfaceId: surface.id,
      ptyId,
    };
    sessions.set(session.session_id, session);
    ptyToSession.set(ptyId, session.session_id);
    pushEvent({
      type: "pane.created",
      paneId: target.id,
      workspaceId: get(activeWorkspace)?.id ?? "",
    });
    pushEvent({
      type: "session.statusChanged",
      sessionId: session.session_id,
      status: "starting",
    });

    if (p.task) {
      setTimeout(() => {
        invoke("write_pty", { ptyId, data: p.task + "\r" }).catch(() => {});
      }, 3000);
    }

    return {
      session_id: session.session_id,
      name: session.name,
      agent: session.agent,
      pid: session.pid,
      status: session.status,
      cwd: session.cwd,
    };
  },
});

registerTool({
  name: "list_sessions",
  description: "List MCP-spawned sessions currently alive in gnar-term.",
  inputSchema: { type: "object", properties: {} },
  handler: () => {
    reapDeadSessions();
    return Array.from(sessions.values()).map((s) => ({
      session_id: s.session_id,
      name: s.name,
      agent: s.agent,
      pid: s.pid,
      status: s.status,
      cwd: s.cwd,
      createdAt: s.createdAt,
    }));
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
  description: "Send text to an MCP session's PTY. Appends Enter unless press_enter is false.",
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
    const p = args as { session_id: string; text: string; press_enter?: boolean };
    const session = sessions.get(p.session_id);
    if (!session) throw new Error(`session ${p.session_id} not found`);
    const data = p.text + (p.press_enter === false ? "" : "\r");
    await invoke("write_pty", { ptyId: session.ptyId, data });
    return { ok: true };
  },
});

registerTool({
  name: "send_keys",
  description: "Send a named keystroke (ctrl+c, enter, escape, arrows, etc.) to an MCP session.",
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
  description: "Read terminal output from an MCP session. Supports cursor-based polling and ANSI stripping.",
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
  description: "Spawn multiple agent sessions in parallel for fan-out workflows.",
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
          },
          required: ["name", "agent", "task"],
        },
      },
    },
    required: ["tasks"],
  },
  handler: async (args) => {
    const { tasks } = args as {
      tasks: Array<{
        name: string;
        agent: AgentType;
        task: string;
        cwd?: string;
        command?: string;
      }>;
    };
    const results: Array<{
      session_id: string;
      name: string;
      agent: AgentType;
      pid: number | undefined;
      error?: string;
    }> = [];
    const spawnTool = TOOLS.find((t) => t.name === "spawn_agent")!;
    for (const taskDef of tasks) {
      try {
        const resp = (await spawnTool.handler({
          name: taskDef.name,
          agent: taskDef.agent,
          task: taskDef.task,
          cwd: taskDef.cwd,
          command: taskDef.command,
        })) as {
          session_id: string;
          name: string;
          agent: AgentType;
          pid: number | undefined;
        };
        results.push({
          session_id: resp.session_id,
          name: resp.name,
          agent: resp.agent,
          pid: resp.pid,
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
    "Declare or replace an extension sidebar section. Side is 'primary' or 'secondary'; items are clickable.",
  inputSchema: {
    type: "object",
    properties: {
      side: { type: "string", enum: ["primary", "secondary"] },
      section_id: { type: "string" },
      title: { type: "string" },
      items: { type: "array" },
    },
    required: ["side", "section_id", "title", "items"],
  },
  handler: (args) => {
    const p = args as {
      side: "primary" | "secondary";
      section_id: string;
      title: string;
      items: SidebarItem[];
    };
    upsertSection({
      side: p.side,
      sectionId: p.section_id,
      title: p.title,
      items: p.items ?? [],
    });
    return { ok: true };
  },
});

registerTool({
  name: "remove_sidebar_section",
  description: "Remove an extension-declared sidebar section. Safe for non-existent IDs.",
  inputSchema: {
    type: "object",
    properties: {
      side: { type: "string", enum: ["primary", "secondary"] },
      section_id: { type: "string" },
    },
    required: ["side", "section_id"],
  },
  handler: (args) => {
    const p = args as { side: "primary" | "secondary"; section_id: string };
    removeSection(p.side, p.section_id);
    return { ok: true };
  },
});

registerTool({
  name: "create_preview",
  description:
    "Open a preview surface with markdown/text/code content. Placement controls where the preview appears.",
  inputSchema: {
    type: "object",
    properties: {
      content: { type: "string" },
      format: { type: "string", enum: ["markdown", "text", "code"] },
      language: { type: "string" },
      title: { type: "string" },
      placement: {
        type: "string",
        enum: ["split-right", "split-down", "new-tab", "current-pane"],
      },
    },
    required: ["content", "format"],
  },
  handler: (args) => {
    const p = args as {
      content: string;
      format: "markdown" | "text" | "code";
      language?: string;
      title?: string;
      placement?: "split-right" | "split-down" | "new-tab" | "current-pane";
    };
    const title = p.title ?? "Preview";
    // Wrap text/code as markdown fenced blocks so the markdown previewer
    // renders them with monospacing and syntax highlighting.
    let rendered: string;
    if (p.format === "markdown") {
      rendered = p.content;
    } else if (p.format === "code") {
      rendered = "```" + (p.language ?? "") + "\n" + p.content + "\n```";
    } else {
      rendered = "```\n" + p.content + "\n```";
    }
    const previewSurface = openPreviewFromContent(rendered, title);

    const placement = p.placement ?? "split-right";
    let targetPane: Pane;
    if (placement === "split-right") {
      targetPane = get(activePane) ? splitActivePane("horizontal") : getOrCreateActivePane();
    } else if (placement === "split-down") {
      targetPane = get(activePane) ? splitActivePane("vertical") : getOrCreateActivePane();
    } else {
      // new-tab and current-pane both drop into the active pane's surface list
      targetPane = getOrCreateActivePane();
    }

    const surface = {
      kind: "preview" as const,
      id: previewSurface.id,
      filePath: previewSurface.filePath,
      title: previewSurface.title,
      element: previewSurface.element,
      watchId: previewSurface.watchId,
      hasUnread: false,
    };
    targetPane.surfaces.push(surface);
    targetPane.activeSurfaceId = surface.id;
    workspaces.update((l) => [...l]);

    return { preview_id: surface.id, pane_id: targetPane.id };
  },
});

// ---- UI introspection ----

registerTool({
  name: "get_active_workspace",
  description: "Return the currently active workspace, or null if none.",
  inputSchema: { type: "object", properties: {} },
  handler: () => {
    const ws = get(activeWorkspace);
    if (!ws) return null;
    return { id: ws.id, name: ws.name, activePaneId: ws.activePaneId };
  },
});

registerTool({
  name: "list_workspaces",
  description: "List all open workspaces.",
  inputSchema: { type: "object", properties: {} },
  handler: () => {
    return get(workspaces).map((ws) => ({
      id: ws.id,
      name: ws.name,
      activePaneId: ws.activePaneId,
    }));
  },
});

registerTool({
  name: "get_active_pane",
  description: "Return the currently active pane with its surfaces, or null.",
  inputSchema: { type: "object", properties: {} },
  handler: () => {
    const ws = get(activeWorkspace);
    const pane = get(activePane);
    if (!ws || !pane) return null;
    return describePane(pane, ws.id);
  },
});

registerTool({
  name: "list_panes",
  description: "List panes in a workspace (defaults to the active workspace).",
  inputSchema: {
    type: "object",
    properties: { workspace_id: { type: "string" } },
  },
  handler: (args) => {
    const p = args as { workspace_id?: string };
    const target = p.workspace_id
      ? get(workspaces).find((w) => w.id === p.workspace_id)
      : get(activeWorkspace);
    if (!target) return [];
    return getAllPanes(target.splitRoot).map((pane) => describePane(pane, target.id));
  },
});

// ---- Lifecycle events ----

registerTool({
  name: "poll_events",
  description: "Poll the 500-entry lifecycle event ring buffer.",
  inputSchema: {
    type: "object",
    properties: {
      cursor: { type: "number" },
      max: { type: "number" },
    },
  },
  handler: (args) => {
    const p = args as { cursor?: number; max?: number };
    return pollEvents({ cursor: p.cursor, max: p.max });
  },
});

// ---- Filesystem ----

registerTool({
  name: "list_dir",
  description: "List a directory. Returns entries with name, path, is_dir, size.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      include_hidden: { type: "boolean" },
    },
    required: ["path"],
  },
  handler: async (args) => {
    const p = args as { path: string; include_hidden?: boolean };
    const entries = await invoke<
      Array<{ name: string; path: string; is_dir: boolean; size: number }>
    >("mcp_list_dir", { path: p.path, includeHidden: p.include_hidden });
    return { entries };
  },
});

registerTool({
  name: "read_file",
  description: "Read a UTF-8 file and return its contents. Non-UTF-8 content is an error.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      max_bytes: { type: "number" },
    },
    required: ["path"],
  },
  handler: async (args) => {
    const p = args as { path: string; max_bytes?: number };
    const content = await invoke<string>("read_file", { path: p.path });
    if (p.max_bytes && content.length > p.max_bytes) {
      return { content: content.slice(0, p.max_bytes), truncated: true };
    }
    return { content, truncated: false };
  },
});

registerTool({
  name: "file_exists",
  description: "Check whether a path exists. Returns exists and (if it does) is_dir.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  handler: async (args) => {
    const p = args as { path: string };
    const [exists, isDir] = await invoke<[boolean, boolean]>("mcp_file_info", {
      path: p.path,
    });
    return exists ? { exists: true, is_dir: isDir } : { exists: false };
  },
});

// ---- JSON-RPC dispatch ----

const PROTOCOL_VERSION = "2025-11-25";
const SERVER_INFO = { name: "gnar-term", version: "0.3.1" };

export async function dispatch(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;
  // Notifications (no id) are fire-and-forget.
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
      case "notifications/initialized":
      case "initialized":
        return null;
      case "tools/list": {
        const tools = TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }));
        return isNotification ? null : { jsonrpc: "2.0", id, result: { tools } };
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
        const value = await tool.handler(params.arguments ?? {});
        if (isNotification) return null;
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(value) }],
            structuredContent: value,
          },
        };
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

/**
 * Initialize the MCP server. Honors the `mcp` config setting:
 * - "off": no-op, module is fully dormant
 * - otherwise: install pty listeners and subscribe to mcp-request events
 */
export async function initMcpServer(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const setting = getMcpSetting();
  if (setting === "off") {
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

  // mcp-request from Rust bridge — each event carries one JSON-RPC message.
  await listen<string>("mcp-request", async (event) => {
    const raw = event.payload;
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(raw) as JsonRpcRequest;
    } catch {
      console.warn("[mcp] malformed request:", raw);
      return;
    }
    const resp = await dispatch(req);
    if (resp) {
      await emit("mcp-response", JSON.stringify(resp));
    }
  });

  // Track workspace/pane focus changes → lifecycle events.
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

export function _getSessionsForTest(): Map<string, McpSession> {
  return sessions;
}

export function _resetMcpServerForTest(): void {
  sessions.clear();
  ptyToSession.clear();
  initialized = false;
}
