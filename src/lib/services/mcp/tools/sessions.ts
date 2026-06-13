/**
 * Session-lifecycle tools: spawn_agent, list_sessions, get_session_info,
 * kill_session.
 */
import { invoke } from "@tauri-apps/api/core";
import { workspaces } from "../../../stores/workspace";
import { createTerminalSurface } from "../../../terminal-service";
import { safeFocus } from "../../service-helpers";
import {
  registerMcpPty,
  unregisterMcpPty,
  getMcpBuffer,
} from "../../mcp-output-buffer";
import { pushEvent } from "../../mcp-event-buffer";
import { registerTool } from "../registry";
import { sessions, ptyToSession, newSessionId } from "../state";
import {
  resolveTarget,
  pickHostPane,
  splitPaneInWorkspace,
  waitForPtyId,
  getPtyCwd,
  removeSurfaceFromPane,
  reapDeadSessions,
} from "../target-resolution";
import { AGENT_COMMANDS, type AgentType, type McpSession } from "../types";

registerTool({
  name: "spawn_agent",
  description:
    "Spawn a new gnar-term pane running an AI coding agent (claude-code, codex, aider) or a custom command. Targets the agent's host workspace by default (per connection binding); pass workspace_id/pane_id to override.",
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
      workspace_id: { type: "string" },
      pane_id: { type: "string" },
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
    };
    let startupCommand: string | undefined;
    if (p.agent === "custom") {
      if (!p.command) throw new Error('agent "custom" requires a command parameter');
      startupCommand = p.command;
    } else {
      const agentCmd = AGENT_COMMANDS[p.agent];
      if (!agentCmd) throw new Error(`unknown agent: ${p.agent}`);
      startupCommand = agentCmd;
    }

    const target = resolveTarget(p, ctx);
    const hostPane = target.hostPane ?? pickHostPane(target.workspace);
    const newPane = splitPaneInWorkspace(target.workspace, hostPane, "vertical");
    ctx.lastSpawnedPaneId = newPane.id;

    const surface = await createTerminalSurface(newPane, p.cwd);
    surface.title = p.name;
    surface.startupCommand = startupCommand;
    newPane.activeSurfaceId = surface.id;
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
      pane_id: newPane.id,
      workspace_id: target.workspace.id,
    };
  },
});

registerTool({
  name: "list_sessions",
  description: "List MCP-spawned sessions currently alive in gnar-term.",
  inputSchema: { type: "object", properties: {} },
  handler: () => {
    reapDeadSessions();
    const list = Array.from(sessions.values()).map((s) => ({
      session_id: s.session_id,
      name: s.name,
      agent: s.agent,
      pid: s.pid,
      status: s.status,
      cwd: s.cwd,
      createdAt: s.createdAt,
    }));
    return { sessions: list };
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
