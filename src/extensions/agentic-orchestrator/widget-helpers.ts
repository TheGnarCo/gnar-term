/**
 * Shared helpers for the markdown-component widgets registered by the
 * agentic-orchestrator extension (Kanban, Issues, AgentList,
 * AgentStatusRow, TaskSpawner). Centralizes throttling, scope
 * resolution, jump-to-pane, and a few small utilities so each widget
 * stays focused on rendering.
 */
import { derived, readable, type Readable } from "svelte/store";
import type { AgentRef, ExtensionAPI } from "../api";
import {
  deriveDashboardScope,
  type DashboardHostContext,
} from "../../lib/contexts/dashboard-host";
import { workspaces } from "../../lib/stores/workspace";
import { workspaceGroupsStore } from "../../lib/stores/workspace-groups";
import { claimedWorkspaceIds } from "../../lib/services/claimed-workspace-registry";
import { getAllSurfaces, isTerminalSurface } from "../../lib/types";

/**
 * Legacy alias preserved for the orchestrator's widget internals — the
 * canonical public type is `AgentRef` from the extension API. Detection
 * moved to core (src/lib/services/agent-detection-service.ts); widgets
 * subscribe via `api.agents` rather than the previous extension-owned
 * registry.
 */
export type DetectedAgent = AgentRef;

/** Minimum interval between widget data refreshes (ms). */
export const WIDGET_THROTTLE_MS = 200;

/** Minimum interval between automatic gh polls (ms). */
export const GH_POLL_THROTTLE_MS = 30_000;

/**
 * Wrap `fn` so it fires at most once per `intervalMs`. The first call
 * runs immediately; subsequent calls inside the window are coalesced
 * into a single trailing invocation. No setTimeout polling — uses a
 * timeout only to deliver the trailing call.
 */
export function throttle<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  intervalMs: number,
): (...args: TArgs) => void {
  let lastCallAt = 0;
  let pending: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: TArgs | null = null;
  return (...args: TArgs) => {
    const now = Date.now();
    const elapsed = now - lastCallAt;
    if (elapsed >= intervalMs) {
      lastCallAt = now;
      fn(...args);
      return;
    }
    lastArgs = args;
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      lastCallAt = Date.now();
      const a = lastArgs;
      lastArgs = null;
      if (a) fn(...a);
    }, intervalMs - elapsed);
  };
}

/**
 * Reactive store of the agents in scope for a widget mounted inside a
 * DashboardHostContext. Implements the §5.3 scope rules:
 *   - no host / "none" scope → empty list
 *   - "global" scope         → every detected agent
 *   - "group" scope          → agents whose workspace has
 *        `metadata.groupId === groupId`, OR whose first terminal CWD
 *        sits under the group's `path` AND the workspace is unclaimed
 *        (claimed workspaces already belong to another owner).
 *
 * Prefix containment uses a trailing-slash suffix so `/work/one` never
 * captures `/work/one-other` by accident.
 */
export function hostScopedAgentsStore(
  api: ExtensionAPI,
  host: DashboardHostContext | null,
): Readable<DetectedAgent[]> {
  const scope = deriveDashboardScope(host);
  if (scope.kind === "none") {
    return readable<DetectedAgent[]>([]);
  }
  if (scope.kind === "global") {
    return derived(api.agents, (agents) => agents);
  }
  return derived(
    [api.agents, workspaces, workspaceGroupsStore, claimedWorkspaceIds],
    ([$agents, $workspaces, $groups, $claimedIds]) => {
      const group = $groups.find((g) => g.id === scope.groupId);
      const base = group?.path ? group.path.replace(/\/+$/, "") : "";
      const prefix = base ? `${base}/` : "";
      const wsById = new Map<string, (typeof $workspaces)[number]>();
      for (const ws of $workspaces) wsById.set(ws.id, ws);
      return $agents.filter((a) => {
        const ws = wsById.get(a.workspaceId);
        if (!ws) return false;
        const md = ws.metadata as Record<string, unknown> | undefined;
        if (md?.groupId === scope.groupId) return true;
        if (!base || $claimedIds.has(ws.id)) return false;
        for (const surface of getAllSurfaces(ws)) {
          if (
            isTerminalSurface(surface) &&
            surface.cwd &&
            (surface.cwd === base || surface.cwd.startsWith(prefix))
          ) {
            return true;
          }
        }
        return false;
      });
    },
  );
}

/**
 * Jump to the surface owning the given agent. Switches workspaces and
 * focuses the pane so the user lands on the agent's terminal.
 */
export function jumpToAgent(api: ExtensionAPI, agent: DetectedAgent): void {
  if (agent.workspaceId) {
    api.switchWorkspace(agent.workspaceId);
  }
  api.focusSurface(agent.surfaceId);
}

/** Color the kanban-card / status-dot uses for a given agent status. */
export function statusColor(status: string): string {
  switch (status) {
    case "running":
    case "active":
      return "#4ec957";
    case "waiting":
      return "#e8b73a";
    case "idle":
      return "#888888";
    case "done":
    case "closed":
      return "#5b9cf2";
    default:
      return "#888888";
  }
}

/** Bucket an agent into one of the four kanban columns. */
export type KanbanColumn = "running" | "waiting" | "idle" | "done";

export function bucketForStatus(status: string): KanbanColumn {
  switch (status) {
    case "running":
    case "active":
      return "running";
    case "waiting":
      return "waiting";
    case "done":
    case "closed":
      return "done";
    default:
      return "idle";
  }
}

/** Format an ISO date as a compact "5m ago" / "3h ago" string. */
export function timeAgo(iso: string): string {
  if (!iso) return "";
  let then: number;
  try {
    then = new Date(iso).getTime();
  } catch {
    return "";
  }
  if (!Number.isFinite(then)) return "";
  const diffMs = Math.max(0, Date.now() - then);
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

/**
 * Resolve a workspace name from an id by walking the api.workspaces
 * snapshot. Returns the id itself when no matching workspace exists
 * (e.g. an agent whose workspace was already torn down).
 */
export function workspaceNameFor(
  api: ExtensionAPI,
  workspaceId: string,
): string {
  if (!workspaceId) return "";
  let name = workspaceId;
  const unsub = api.workspaces.subscribe((list) => {
    const ws = list.find((w) => w.id === workspaceId);
    if (ws) name = ws.name;
  });
  unsub();
  return name;
}

/**
 * Convert a free-form task title to a slug suitable for a branch name
 * (lowercased, hyphenated, alphanumeric+dashes only). Empty input
 * collapses to "task".
 */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug.length > 0 ? slug : "task";
}
