import { get } from "svelte/store";
import {
  nestedWorkspaces,
  activeWorkspace,
  activePane,
} from "../../stores/nested-workspace";
import {
  getAllPanes,
  isTerminalSurface,
  type Pane,
  type Surface,
} from "../../types";
import { listPreviewSurfaces } from "../preview-surface-registry";
import { pollEvents } from "../mcp-event-buffer";
import { agentsStore } from "../agent-detection-service";
import { interruptAgent, killAgent } from "../agent-intervention-service";
import type { ToolDef } from "../mcp-types";

// ---- NestedWorkspace introspection helpers ----

function describeSurface(s: Surface) {
  return { id: s.id, kind: s.kind, title: s.title };
}

function describePane(pane: Pane, workspaceId: string) {
  const activeSurface = pane.surfaces.find(
    (s) => s.id === pane.activeSurfaceId,
  );
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

export const introspectionTools: ToolDef[] = [
  {
    name: "list_agents",
    description:
      "List all detected AI agents currently running in gnar-term terminals — includes both MCP-spawned agents and native agents started by the user (e.g. by typing `claude`, `codex`, `aider`). Each entry contains agentId, agentName, surfaceId, workspaceId, status, createdAt, and lastStatusChange.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const agents = get(agentsStore).map((a) => ({
        agentId: a.agentId,
        agentName: a.agentName,
        surfaceId: a.surfaceId,
        workspaceId: a.workspaceId,
        status: a.status,
        createdAt: a.createdAt,
        lastStatusChange: a.lastStatusChange,
      }));
      return { agents };
    },
  },
  {
    name: "get_active_workspace",
    description:
      "Return the workspace the user is currently focused on. Reports user GUI focus, NOT the agent's binding — agents should use get_agent_context for routing. Fields are null when no workspace is open.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const ws = get(activeWorkspace);
      return {
        id: ws?.id ?? null,
        name: ws?.name ?? null,
        activePaneId: ws?.activePaneId ?? null,
      };
    },
  },
  {
    name: "list_workspaces",
    description: "List all open nestedWorkspaces.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const list = get(nestedWorkspaces).map((ws) => ({
        id: ws.id,
        name: ws.name,
        activePaneId: ws.activePaneId,
      }));
      return { nestedWorkspaces: list };
    },
  },
  {
    name: "get_active_pane",
    description:
      "Return the user-focused pane and its surfaces. Reports user GUI focus, NOT the agent's binding. `pane` is null when no pane is focused.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const ws = get(activeWorkspace);
      const pane = get(activePane);
      if (!ws || !pane) return { pane: null };
      return { pane: describePane(pane, ws.id) };
    },
  },
  {
    name: "list_panes",
    description:
      "List panes in a workspace (defaults to the active workspace).",
    inputSchema: {
      type: "object",
      properties: { workspace_id: { type: "string" } },
    },
    handler: (args) => {
      const p = args as { workspace_id?: string };
      const target = p.workspace_id
        ? get(nestedWorkspaces).find((w) => w.id === p.workspace_id)
        : get(activeWorkspace);
      if (!target) return { panes: [] };
      const list = getAllPanes(target.splitRoot).map((pane) =>
        describePane(pane, target.id),
      );
      return { panes: list };
    },
  },
  {
    name: "list_open_previews",
    description:
      "List all currently open preview surfaces. Returns `{ surface_id, path, pane_id, workspace_id }` for each.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const previews = listPreviewSurfaces().map((e) => ({
        surface_id: e.surfaceId,
        path: e.path,
        pane_id: e.paneId,
        workspace_id: e.workspaceId,
      }));
      return { previews };
    },
  },
  {
    name: "interrupt_agent",
    description:
      "Send Ctrl-C (SIGINT) to a detected agent's PTY — equivalent to the user pressing Ctrl-C in the agent's terminal. Returns `{ ok: true }` on success, `{ ok: false }` when the agent is not found or has no PTY. Use list_agents to get agent_id values.",
    inputSchema: {
      type: "object",
      properties: { agent_id: { type: "string" } },
      required: ["agent_id"],
    },
    handler: async (args) => {
      const { agent_id } = args as { agent_id: string };
      const ok = await interruptAgent(agent_id);
      return { ok };
    },
  },
  {
    name: "kill_agent",
    description:
      "Forcefully kill a detected agent's PTY process. Returns `{ ok: true }` on success, `{ ok: false }` when the agent is not found or has no PTY. Prefer interrupt_agent (Ctrl-C) first; use kill_agent only when the agent is unresponsive.",
    inputSchema: {
      type: "object",
      properties: { agent_id: { type: "string" } },
      required: ["agent_id"],
    },
    handler: async (args) => {
      const { agent_id } = args as { agent_id: string };
      const ok = await killAgent(agent_id);
      return { ok };
    },
  },
  {
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
  },
];
