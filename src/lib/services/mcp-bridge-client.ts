/**
 * WebSocket client that connects to the gnar-term-agent-mcp sidecar and
 * handles bridge op requests from the sidecar's tools.
 *
 * See packages/gnar-term-agent-mcp/SPEC.md for the wire protocol.
 */
import { get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
  type TerminalSurface,
} from "../types";
import { createTerminalSurface } from "../terminal-service";
import { createWorkspace } from "./workspace-service";
import { findParentSplit, replaceNodeInTree } from "../types";
import { safeFocus } from "./service-helpers";
import {
  installMcpOutputListener,
  registerMcpPty,
  unregisterMcpPty,
  getMcpBuffer,
} from "./mcp-output-buffer";

type AgentType = "claude-code" | "codex" | "aider" | "custom";
type SessionStatus = "starting" | "running" | "idle" | "exited";

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

interface BridgeRequest {
  type: "request";
  id: string;
  op: string;
  params: Record<string, unknown>;
}

interface BridgeResponse {
  type: "response";
  id: string;
  result?: unknown;
  error?: string;
}

const sessions = new Map<string, McpSession>();
const ptyToSession = new Map<number, string>();

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function newSessionId(): string {
  return `mcp-${crypto.randomUUID()}`;
}

function send(msg: BridgeResponse): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(msg));
}

async function handleRequest(req: BridgeRequest): Promise<BridgeResponse> {
  try {
    const handler = handlers[req.op];
    if (!handler) {
      return { type: "response", id: req.id, error: `unknown op: ${req.op}` };
    }
    const result = await handler(req.params);
    return { type: "response", id: req.id, result };
  } catch (err) {
    return {
      type: "response",
      id: req.id,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// --- Pane plumbing ---

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
  // No panes at all — create one
  const newPane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
  ws.splitRoot = { type: "pane", pane: newPane };
  workspaces.update((l) => [...l]);
  return newPane;
}

function splitActivePane(direction: "horizontal" | "vertical"): Pane {
  const wsVal = get(activeWorkspace);
  if (!wsVal) {
    createWorkspace("MCP");
  }
  const workspace = get(activeWorkspace)!;
  const currentActive = get(activePane) ?? getAllPanes(workspace.splitRoot)[0];
  if (!currentActive) {
    return getOrCreateActivePane();
  }
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

// --- Bridge op handlers ---

type Handler = (params: Record<string, unknown>) => Promise<unknown> | unknown;

const handlers: Record<string, Handler> = {
  spawn_pane: async (params) => {
    const p = params as {
      name: string;
      agent: AgentType;
      task?: string;
      cwd?: string;
      command?: string;
      env?: Record<string, string>;
      cols?: number;
      rows?: number;
    };

    // Resolve command to run
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

    // Place the pane: split the current active pane vertically so the new
    // session is immediately visible alongside whatever the user was doing.
    // If there is no active pane yet, this just creates the first pane.
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

    // Optional initial task — send after a short delay so the agent has time
    // to boot.
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

  list_sessions: () => {
    // Drop sessions whose surface/pane no longer exists
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

  get_session_info: (params) => {
    const { session_id } = params as { session_id: string };
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

  kill_session: async (params) => {
    const { session_id } = params as { session_id: string; signal?: string };
    const session = sessions.get(session_id);
    if (!session) throw new Error(`session ${session_id} not found`);
    try {
      await invoke("kill_pty", { ptyId: session.ptyId });
    } catch (err) {
      // PTY may already be gone — continue cleanup regardless
      console.warn("kill_pty failed:", err);
    }
    // Remove the surface from its pane, mirroring the pty-exit path
    removeSurfaceFromPane(session.paneId, session.surfaceId);
    unregisterMcpPty(session.ptyId);
    ptyToSession.delete(session.ptyId);
    sessions.delete(session.session_id);
    return { ok: true };
  },

  send_prompt: async (params) => {
    const p = params as {
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

  send_keys: async (params) => {
    const p = params as { session_id: string; keys: string };
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

  read_output: (params) => {
    const p = params as {
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

  dispatch_tasks: async (params) => {
    const { tasks } = params as {
      tasks: Array<{
        name: string;
        agent: AgentType;
        task: string;
        cwd?: string;
        command?: string;
        env?: Record<string, string>;
      }>;
    };
    const results: Array<{
      session_id: string;
      name: string;
      agent: AgentType;
      pid: number | undefined;
      error?: string;
    }> = [];
    for (const taskDef of tasks) {
      try {
        const resp = (await handlers.spawn_pane({
          name: taskDef.name,
          agent: taskDef.agent,
          task: taskDef.task,
          cwd: taskDef.cwd,
          command: taskDef.command,
          env: taskDef.env,
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
};

// --- Surface / session cleanup helpers ---

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
            // Ignore
          }
        }
        pane.surfaces.splice(idx, 1);
        if (pane.surfaces.length === 0) {
          // Let the existing pty-exit cleanup collapse empty panes on the
          // next tick; we don't replicate that logic here.
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

// --- Connection lifecycle ---

async function readPortFile(): Promise<number | null> {
  try {
    const home = await invoke<string>("get_home");
    const path = `${home}/.config/gnar-term/mcp-bridge.port`;
    const contents = await invoke<string>("read_file", { path });
    const port = parseInt(contents.trim(), 10);
    return Number.isFinite(port) ? port : null;
  } catch {
    return null;
  }
}

async function tryConnect(): Promise<void> {
  const port = await readPortFile();
  if (port === null) {
    scheduleReconnect();
    return;
  }
  try {
    ws = new WebSocket(`ws://127.0.0.1:${port}`);
  } catch (err) {
    console.warn("[mcp-bridge] failed to construct WebSocket:", err);
    scheduleReconnect();
    return;
  }
  ws.addEventListener("open", () => {
    console.log("[mcp-bridge] connected");
  });
  ws.addEventListener("message", async (event) => {
    let msg: BridgeRequest;
    try {
      msg = JSON.parse(event.data as string);
    } catch {
      return;
    }
    if (msg.type !== "request") return;
    const response = await handleRequest(msg);
    send(response);
  });
  ws.addEventListener("close", () => {
    console.log("[mcp-bridge] disconnected");
    ws = null;
    scheduleReconnect();
  });
  ws.addEventListener("error", () => {
    // Let close handler schedule reconnect
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    tryConnect().catch((err) => {
      console.warn("[mcp-bridge] reconnect failed:", err);
      scheduleReconnect();
    });
  }, 2000);
}

export async function initMcpBridgeClient(): Promise<void> {
  await installMcpOutputListener();

  // Listen for pty-exit to clean up MCP session state in lockstep with the
  // webview's own cleanup.
  await listen<{ pty_id: number }>("pty-exit", (event) => {
    const sessionId = ptyToSession.get(event.payload.pty_id);
    if (!sessionId) return;
    const session = sessions.get(sessionId);
    if (session) {
      session.status = "exited";
    }
    unregisterMcpPty(event.payload.pty_id);
    ptyToSession.delete(event.payload.pty_id);
    // Keep the session record around so list_sessions can still surface it
    // briefly; reapDeadSessions will drop it on next list.
  });

  tryConnect().catch((err) => {
    console.warn("[mcp-bridge] initial connect failed:", err);
    scheduleReconnect();
  });
}
