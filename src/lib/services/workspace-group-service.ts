/**
 * Workspace Group Service — CRUD + flow functions for the core
 * Workspace Group primitive. Relocated from the project-scope extension
 * in Stage 5; see ADR 004.
 *
 * Components and core commands call into this module rather than
 * touching the `workspaceGroupsStore` directly so state transitions
 * (adding to root-row order, claiming workspaces, tearing down the
 * Dashboard workspace on delete) stay colocated with the store write.
 */
import { invoke } from "@tauri-apps/api/core";
import { get } from "svelte/store";
import type { WorkspaceGroupEntry } from "../config";
import { appendRootRow, removeRootRow } from "../stores/root-row-order";
import { workspaces, activeWorkspaceIdx } from "../stores/workspace";
import { claimWorkspace, unclaimWorkspace } from "./claimed-workspace-registry";
import {
  getWorkspaceGroup,
  getWorkspaceGroups,
  setActiveGroupId,
  setWorkspaceGroups,
} from "../stores/workspace-groups";
import { createWorkspaceFromDef, closeWorkspace } from "./workspace-service";
import { eventBus } from "./event-bus";

export const WORKSPACE_GROUP_STATE_CHANGED =
  "extension:workspace-group:state-changed";
export const WORKSPACE_GROUP_DIALOG_TOGGLE =
  "extension:workspace-group:dialog-toggle";

export type WorkspaceGroupStateChangedEvent =
  typeof WORKSPACE_GROUP_STATE_CHANGED;

function emitStateChanged(metadata: Record<string, unknown> = {}): void {
  eventBus.emit({
    type: WORKSPACE_GROUP_STATE_CHANGED,
    ...metadata,
  });
}

export function addWorkspaceGroup(group: WorkspaceGroupEntry): void {
  setWorkspaceGroups([...getWorkspaceGroups(), group]);
  appendRootRow({ kind: "workspace-group", id: group.id });
  emitStateChanged({ groupId: group.id });
}

export function updateWorkspaceGroup(
  id: string,
  patch: Partial<Omit<WorkspaceGroupEntry, "id">>,
): void {
  const next = getWorkspaceGroups().map((g) =>
    g.id === id ? { ...g, ...patch } : g,
  );
  setWorkspaceGroups(next);
  emitStateChanged({ groupId: id });
}

export function deleteWorkspaceGroup(id: string): void {
  const next = getWorkspaceGroups().filter((g) => g.id !== id);
  setWorkspaceGroups(next);
  removeRootRow({ kind: "workspace-group", id });
  emitStateChanged({ groupId: id });
}

/**
 * Appends `workspaceId` to `groupId`'s workspaceIds if not already
 * present. No-op when the group is missing (e.g. was just deleted).
 * Returns true when a change was persisted.
 */
export function addWorkspaceToGroup(
  groupId: string,
  workspaceId: string,
): boolean {
  const groups = getWorkspaceGroups();
  let changed = false;
  const next = groups.map((g) => {
    if (g.id === groupId && !g.workspaceIds.includes(workspaceId)) {
      changed = true;
      return { ...g, workspaceIds: [...g.workspaceIds, workspaceId] };
    }
    return g;
  });
  if (!changed) return false;
  setWorkspaceGroups(next);
  emitStateChanged({ groupId });
  return true;
}

/**
 * Strips `workspaceId` from every group's workspaceIds. Used when a
 * workspace is closed — the group membership is inferred from workspace
 * metadata, so removing from all is cheap and idempotent.
 */
export function removeWorkspaceFromAllGroups(workspaceId: string): void {
  const next = getWorkspaceGroups().map((g) => ({
    ...g,
    workspaceIds: g.workspaceIds.filter((id) => id !== workspaceId),
  }));
  setWorkspaceGroups(next);
  emitStateChanged({});
}

/**
 * Path of the markdown file backing a group's Dashboard. Lives inside
 * the group's own `.gnar-term/` directory so multi-machine sync /
 * checkout follows the group itself.
 */
export function groupDashboardPath(groupPath: string): string {
  return `${groupPath.replace(/\/+$/, "")}/.gnar-term/project-dashboard.md`;
}

function buildGroupDashboardMarkdown(group: WorkspaceGroupEntry): string {
  // The Group Dashboard is the generic, agent-agnostic landing page for
  // a Workspace Group. Per the spec / user intent it surfaces work-
  // tracker links (diffs, open PRs) rather than agent telemetry — that
  // lives on the optional Agentic Dashboard contribution.
  //
  // `gnar:issues` is registered by the agentic extension; when the
  // extension is disabled the markdown previewer renders it as an
  // "Unknown widget" fallback, which degrades gracefully without
  // breaking the Dashboard for users who don't want agents.
  return `# ${group.name}

Project at \`${group.path}\`.

## Open Issues & PRs

\`\`\`gnar:issues
state: open
limit: 25
\`\`\`

## Quick Links

- [Browse on GitHub](https://github.com)
- Run \`gh pr list\` in any workspace terminal for the current PR queue
- Use **Promote to Workspace Group** on any workspace to nest it here
`;
}

async function writeGroupDashboardTemplate(
  group: WorkspaceGroupEntry,
  path: string,
): Promise<void> {
  const exists = await invoke<boolean>("file_exists", { path }).catch(
    () => false,
  );
  if (exists) return;
  const dir = path.replace(/\/[^/]+$/, "");
  await invoke("ensure_dir", { path: dir });
  await invoke("write_file", {
    path,
    content: buildGroupDashboardMarkdown(group),
  });
}

/**
 * Create the Dashboard workspace for a group: a constrained workspace
 * (metadata.isDashboard = true) hosting a single Live Preview of the
 * group's markdown file. Returns the new workspace id so the group
 * record can link to it.
 */
export async function createGroupDashboardWorkspace(
  group: WorkspaceGroupEntry,
): Promise<string> {
  const path = groupDashboardPath(group.path);
  try {
    await writeGroupDashboardTemplate(group, path);
  } catch {
    // Best-effort write — the workspace can still be created; the
    // preview surface will surface the backing-file error if relevant.
  }
  return await createWorkspaceFromDef({
    name: "Dashboard",
    layout: {
      pane: {
        surfaces: [
          {
            type: "preview",
            path,
            name: group.name,
            focus: true,
          },
        ],
      },
    },
    metadata: {
      isDashboard: true,
      groupId: group.id,
    },
  });
}

/**
 * Switch to a group's Dashboard workspace. The Dashboard is created
 * eagerly on group creation, so this is a pure activation call.
 * Returns true on success.
 */
export function openGroupDashboard(group: WorkspaceGroupEntry): boolean {
  const targetId = group.dashboardWorkspaceId;
  if (!targetId) return false;
  const idx = get(workspaces).findIndex((w) => w.id === targetId);
  if (idx < 0) return false;
  activeWorkspaceIdx.set(idx);
  return true;
}

/**
 * Close the Dashboard workspace backing `group` if it is currently
 * open. Used during group deletion so the workspace disappears
 * alongside the group record.
 */
export async function closeGroupDashboardWorkspace(
  group: WorkspaceGroupEntry,
): Promise<void> {
  const dashboardWsId = group.dashboardWorkspaceId;
  if (!dashboardWsId) return;
  const wsIdx = get(workspaces).findIndex((w) => w.id === dashboardWsId);
  if (wsIdx >= 0) closeWorkspace(wsIdx);
}

/** True when the workspace is a Group Dashboard owned by `groupId`. */
function isGroupDashboardFor(
  ws: { metadata?: unknown },
  groupId: string,
): boolean {
  const md = ws.metadata as Record<string, unknown> | undefined;
  if (!md) return false;
  const contribution = md.dashboardContributionId;
  const hasContributionMarker =
    contribution === undefined || contribution === "group";
  return (
    md.isDashboard === true && md.groupId === groupId && hasContributionMarker
  );
}

/**
 * Called on app startup (after workspaces are restored) — ensures every
 * group has exactly one Group Dashboard workspace. Prior releases
 * matched the dashboard via `group.dashboardWorkspaceId`; workspace
 * ids were unstable across restarts, so on every reload the lookup
 * missed and a fresh dashboard was spawned. The cleanup runs in three
 * passes:
 *
 *   1. Adopt the first workspace matching `metadata.isDashboard ===
 *      true && metadata.groupId === group.id` (with no contribution id,
 *      or an explicit `"group"` id) — rebinding the group's
 *      `dashboardWorkspaceId` to that workspace.
 *   2. Close every extra Group Dashboard for the same group (users end
 *      up with these when pre-fix state carried duplicates).
 *   3. Only when no dashboard exists at all, create a fresh one.
 *
 * The loop is sequential because `closeWorkspace` mutates the
 * workspaces store and ripples to `$activeWorkspaceIdx`.
 */
export async function reconcileGroupDashboards(): Promise<void> {
  for (const group of getWorkspaceGroups()) {
    const matches = get(workspaces).filter((w) =>
      isGroupDashboardFor(w, group.id),
    );

    if (matches.length === 0) {
      // Fall through to the creation path below.
    } else {
      const [keep, ...extras] = matches;
      if (keep && keep.id !== group.dashboardWorkspaceId) {
        updateWorkspaceGroup(group.id, { dashboardWorkspaceId: keep.id });
      }
      for (const dup of extras) {
        const idx = get(workspaces).findIndex((w) => w.id === dup.id);
        if (idx >= 0) closeWorkspace(idx);
      }
      continue;
    }
    try {
      const dashboardWorkspaceId = await createGroupDashboardWorkspace(group);
      updateWorkspaceGroup(group.id, { dashboardWorkspaceId });
    } catch (err) {
      console.warn("[workspace-groups] Dashboard reconciliation failed:", err);
    }
  }
}

/**
 * Re-claim workspaces tagged with `metadata.groupId` that belong to a
 * known group. Called on app startup once groups are loaded and
 * workspaces are restored — restoration creates fresh workspace ids so
 * we rebuild each group's workspaceIds list here.
 */
export function reclaimWorkspacesAcrossGroups(): void {
  const groupIds = new Set(getWorkspaceGroups().map((g) => g.id));
  for (const ws of get(workspaces)) {
    const md = ws.metadata as Record<string, unknown> | undefined;
    const groupId = md?.groupId;
    if (typeof groupId !== "string") continue;
    if (!groupIds.has(groupId)) continue;
    addWorkspaceToGroup(groupId, ws.id);
    claimWorkspace(ws.id, "core");
  }
}

export {
  getWorkspaceGroup,
  getWorkspaceGroups,
  setActiveGroupId,
  unclaimWorkspace,
  claimWorkspace,
};
