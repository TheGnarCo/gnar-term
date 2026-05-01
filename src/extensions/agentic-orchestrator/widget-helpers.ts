/**
 * Shared helpers for the markdown-component widgets registered by the
 * agentic-orchestrator extension (Kanban, Issues, AgentList,
 * AgentStatusRow, TaskSpawner). Centralizes throttling, scope
 * resolution, jump-to-pane, and a few small utilities so each widget
 * stays focused on rendering.
 */
import { derived, readable, get, type Readable } from "svelte/store";
import type { AgentRef, ExtensionAPI } from "../api";
import {
  deriveDashboardScope,
  type DashboardHostContext,
  type DashboardScope,
} from "../../lib/contexts/dashboard-host";
import { nestedWorkspaces } from "../../lib/stores/workspace";
import {
  getWorkspaceGroup,
  workspaceGroupsStore,
} from "../../lib/stores/workspace-groups";
import { claimedWorkspaceIds } from "../../lib/services/claimed-workspace-registry";
import type {
  SpawnedByMarker,
  SpawnAgentType,
} from "../../lib/services/spawn-helper";
import { getAllSurfaces, isTerminalSurface } from "../../lib/types";

/** Minimum interval between widget data refreshes (ms). */
export const WIDGET_THROTTLE_MS = 200;

export const SPAWN_AGENT_OPTIONS: Array<{ id: SpawnAgentType; label: string }> =
  [
    { id: "claude-code", label: "Claude Code" },
    { id: "codex", label: "Codex" },
    { id: "aider", label: "Aider" },
    { id: "custom", label: "Custom..." },
  ];

/**
 * Minimum interval between automatic `gh_*` polls — also used as both
 * the per-widget throttle window and the auto-poll setInterval cadence
 * (Issues + Prs widgets). The user can always click "Refresh" for an
 * immediate re-fetch (force=true bypasses this throttle).
 *
 * Sized to keep us comfortably under GitHub's rate limits even with
 * many group dashboards mounted at once: with 5 group dashboards × 2
 * widgets each, a 5-minute cycle is 120 calls/hour total — well under
 * the 5000/hour authenticated REST limit and the GraphQL points cap.
 * 30s polling (the previous value) put us at ~1200 calls/hour for the
 * same configuration, which was tripping rate-limit errors in
 * practice.
 */
export const GH_POLL_THROTTLE_MS = 300_000;

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
 * Shared module-level derived store: maps each groupId to the set of
 * workspace IDs that belong to it under the §5.3 criteria (metadata,
 * explicit membership, and CWD-prefix fallback for unclaimed nestedWorkspaces).
 *
 * Computed once whenever nestedWorkspaces / groups / claimed-ids change — all
 * mounted dashboard widgets share this single computation instead of each
 * widget independently re-walking every workspace's surfaces on every
 * emission (F32 perf fix).
 */
const _groupWorkspaceIndex = derived(
  [nestedWorkspaces, workspaceGroupsStore, claimedWorkspaceIds],
  ([$nestedWorkspaces, $groups, $claimedIds]): Map<string, Set<string>> => {
    const index = new Map<string, Set<string>>();
    for (const group of $groups) {
      const base = group.path ? group.path.replace(/\/+$/, "") : "";
      const prefix = base ? `${base}/` : "";
      const members = new Set<string>(group.workspaceIds ?? []);
      for (const ws of $nestedWorkspaces) {
        const md = ws.metadata as Record<string, unknown> | undefined;
        // Criterion 1: workspace was created with this group's id in metadata.
        if (md?.groupId === group.id) {
          members.add(ws.id);
          continue;
        }
        // Criterion 2: workspace is explicitly listed in group.workspaceIds
        // — already in `members` from the initial Set construction above.
        if (members.has(ws.id)) continue;
        // Criterion 3: CWD fallback — only for unclaimed nestedWorkspaces so we
        // don't double-count nestedWorkspaces already owned by another group/owner.
        if (!base || $claimedIds.has(ws.id)) continue;
        for (const surface of getAllSurfaces(ws)) {
          if (
            isTerminalSurface(surface) &&
            surface.cwd &&
            (surface.cwd === base || surface.cwd.startsWith(prefix))
          ) {
            members.add(ws.id);
            break;
          }
        }
      }
      index.set(group.id, members);
    }
    return index;
  },
);

/**
 * Reactive store of the agents in scope for a widget mounted inside a
 * DashboardHostContext. Implements the §5.3 scope rules:
 *   - no host / "none" scope → empty list
 *   - "global" scope         → every detected agent
 *   - "group" scope          → agents whose workspace satisfies any of:
 *        1. `metadata.groupId === groupId` (set by workspace creation)
 *        2. workspace id is in `group.workspaceIds` (set by drag-drop /
 *           promote-to-group flows that don't stamp metadata.groupId)
 *        3. workspace is unclaimed AND its first terminal CWD sits under
 *           the group's `path` prefix (catches native agents in terminals
 *           that were never explicitly added to the group)
 *
 * Criteria 1 and 2 are checked before the claimed-workspace guard because
 * both represent explicit group membership — a workspace that belongs to
 * this group should appear even if it has been claimed by "core".
 *
 * Prefix containment uses a trailing-slash suffix so `/work/one` never
 * captures `/work/one-other` by accident.
 */
export function hostScopedAgentsStore(
  api: ExtensionAPI,
  host: DashboardHostContext | null,
): Readable<AgentRef[]> {
  const scope = deriveDashboardScope(host);
  if (scope.kind === "none") {
    return readable<AgentRef[]>([]);
  }
  if (scope.kind === "global") {
    return derived(api.agents, (agents) => agents);
  }
  // "group" scope: each widget's derived store filters api.agents using the
  // shared _groupWorkspaceIndex (O(1) lookup per agent) rather than walking
  // all nestedWorkspaces × surfaces independently.
  return derived([api.agents, _groupWorkspaceIndex], ([$agents, $index]) => {
    const members = $index.get(scope.groupId);
    if (!members) return [];
    return $agents.filter((a) => members.has(a.workspaceId));
  });
}

/**
 * Jump to the surface owning the given agent. Switches nestedWorkspaces and
 * focuses the pane so the user lands on the agent's terminal.
 */
export function jumpToAgent(api: ExtensionAPI, agent: AgentRef): void {
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
 * Resolve a workspace name from an id by walking the api.nestedWorkspaces
 * snapshot. Returns the id itself when no matching workspace exists
 * (e.g. an agent whose workspace was already torn down).
 */
export function workspaceNameFor(
  api: ExtensionAPI,
  workspaceId: string,
): string {
  if (!workspaceId) return "";
  const ws = get(api.nestedWorkspaces).find((w) => w.id === workspaceId);
  return ws?.name ?? workspaceId;
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

/**
 * Resolved target for a dashboard-hosted spawn action (TaskSpawner,
 * Issues). Shared by widgets so the scope→repoPath/spawnedBy mapping
 * stays consistent.
 */
export type SpawnTarget =
  | {
      ok: true;
      repoPath: string;
      spawnedBy: SpawnedByMarker;
      groupId?: string;
    }
  | { ok: false; error: string };

export function resolveSpawnTarget(
  scope: DashboardScope,
  repoPathProp: string | undefined,
): SpawnTarget {
  if (scope.kind === "group") {
    const group = getWorkspaceGroup(scope.groupId);
    if (!group) return { ok: false, error: "Workspace Group not found" };
    return {
      ok: true,
      repoPath: group.path,
      spawnedBy: { kind: "group", groupId: scope.groupId },
      groupId: scope.groupId,
    };
  }
  if (scope.kind === "global") {
    if (!repoPathProp || !repoPathProp.trim()) {
      return { ok: false, error: "Global scope requires a repoPath config" };
    }
    return {
      ok: true,
      repoPath: repoPathProp,
      spawnedBy: { kind: "global" },
    };
  }
  return { ok: false, error: "Dashboard host scope is required" };
}

/**
 * Common `data-scope-*` attribute pair for dashboard widget roots.
 * Keeps test selectors consistent across AgentList / Kanban / Issues /
 * TaskSpawner; spread onto the widget's root element.
 */
export function scopeAttrs(scope: DashboardScope): Record<string, string> {
  return {
    "data-scope-kind": scope.kind,
    "data-scope-group-id": scope.kind === "group" ? scope.groupId : "",
  };
}
