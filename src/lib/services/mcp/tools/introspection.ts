/**
 * Introspection + lifecycle-event tools:
 *   get_agent_context (agent binding),
 *   get_active_workspace / list_workspaces / get_active_pane / list_panes
 *     (user GUI focus observers),
 *   poll_events (lifecycle ring buffer).
 */
import { get } from "svelte/store";
import {
  workspaces,
  activeWorkspace,
  activePane,
} from "../../../stores/workspace";
import { getAllPanes } from "../../../types";
import { pollEvents } from "../../mcp-event-buffer";
import { registerTool } from "../registry";
import { describePane } from "../target-resolution";

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

// ---- UI introspection (observers; report user GUI focus) ----

registerTool({
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
});

registerTool({
  name: "list_workspaces",
  description: "List all open workspaces.",
  inputSchema: { type: "object", properties: {} },
  handler: () => {
    const list = get(workspaces).map((ws) => ({
      id: ws.id,
      name: ws.name,
      activePaneId: ws.activePaneId,
    }));
    return { workspaces: list };
  },
});

registerTool({
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
    if (!target) return { panes: [] };
    const list = getAllPanes(target.splitRoot).map((pane) => describePane(pane, target.id));
    return { panes: list };
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
