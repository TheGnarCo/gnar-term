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
import {
  getDashboardContribution,
  getDashboardContributions,
} from "./dashboard-contribution-registry";

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
 * Close every workspace tagged with `metadata.groupId === id`. Deletion
 * ripples through the workspaces store, so we resolve each workspace by
 * id after recollecting the list. Dashboard workspaces for the group
 * match the same predicate and are closed here too; callers should not
 * close the dashboard separately.
 */
export function closeWorkspacesInGroup(id: string): void {
  const matchIds = get(workspaces)
    .filter((w) => {
      const md = w.metadata as Record<string, unknown> | undefined;
      return md?.groupId === id;
    })
    .map((w) => w.id);
  for (const wsId of matchIds) {
    const idx = get(workspaces).findIndex((w) => w.id === wsId);
    if (idx >= 0) closeWorkspace(idx);
  }
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
 * Remove the legacy `## Active Agents` section (heading + adjacent
 * `gnar:agent-list` fenced code block) from group Overview markdown.
 *
 * Older templates emitted this section into every group's
 * `project-dashboard.md`; once the Agentic Dashboard became its own
 * tile the widget's presence on the Overview was redundant. The
 * template stopped emitting it, but existing user files kept the
 * stale block. This runs once per reconciliation pass — idempotent by
 * design (match-or-skip, never appends).
 *
 * The matcher is strict: heading "## Active Agents" followed by
 * whitespace and a `gnar:agent-list` fenced code block. If the user
 * has added custom content under the heading, no match occurs and the
 * file is left alone.
 */
function stripActiveAgentsSection(markdown: string): string | null {
  const pattern =
    /\n*##\s+Active Agents\s*\n+```gnar:agent-list\n[^`]*```\s*\n?/;
  if (!pattern.test(markdown)) return null;
  return markdown.replace(pattern, "\n");
}

async function scrubGroupDashboardActiveAgents(path: string): Promise<void> {
  try {
    const exists = await invoke<boolean>("file_exists", { path }).catch(
      () => false,
    );
    if (!exists) return;
    const content = await invoke<string>("read_file", { path });
    const next = stripActiveAgentsSection(content);
    if (next === null) return;
    await invoke("write_file", { path, content: next });
  } catch (err) {
    console.warn(
      `[workspace-groups] Failed to scrub Active Agents from "${path}":`,
      err,
    );
  }
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
 * Materialize the Settings dashboard workspace for a group — a
 * constrained dashboard (metadata.isDashboard = true,
 * dashboardContributionId = "settings") whose body PaneView renders as
 * the shared `<GroupDashboardSettings>` component. The workspace carries
 * a single empty preview surface so it satisfies the workspace schema;
 * PaneView intercepts and replaces the surface render for settings
 * contributions.
 */
export async function createSettingsDashboardWorkspace(
  group: WorkspaceGroupEntry,
): Promise<string> {
  return await createWorkspaceFromDef({
    name: "Settings",
    layout: {
      pane: {
        surfaces: [],
      },
    },
    metadata: {
      isDashboard: true,
      groupId: group.id,
      dashboardContributionId: "settings",
    },
  });
}

/**
 * Returns true when a workspace exists in the store for the given
 * group + contribution pair. Used by the auto-provision loop to decide
 * whether to skip contribution.create().
 */
function hasDashboardWorkspace(groupId: string, contribId: string): boolean {
  return get(workspaces).some((w) => {
    const md = w.metadata as Record<string, unknown> | undefined;
    return (
      md?.isDashboard === true &&
      md?.groupId === groupId &&
      md?.dashboardContributionId === contribId
    );
  });
}

/**
 * Provision every registered `autoProvision` dashboard contribution for
 * `group`. Called after a group is created and on startup
 * reconciliation so auto-provision contributions (settings, agentic)
 * always have their workspace available. Idempotent — a contribution
 * already backed by a workspace is skipped.
 */
export async function provisionAutoDashboardsForGroup(
  group: WorkspaceGroupEntry,
): Promise<void> {
  for (const c of getDashboardContributions()) {
    if (!c.autoProvision) continue;
    if (hasDashboardWorkspace(group.id, c.id)) continue;
    try {
      await c.create(group);
    } catch (err) {
      console.warn(
        `[workspace-groups] auto-provision failed for "${c.id}":`,
        err,
      );
    }
  }
}

/**
 * Close every workspace whose `dashboardContributionId` belongs to a
 * contribution registered by `source` and marked autoProvision. Used on
 * extension deactivate so auto-provisioned dashboards disappear
 * alongside their owning extension.
 */
export function closeAutoDashboardsBySource(source: string): void {
  const autoIds = new Set(
    getDashboardContributions()
      .filter((c) => c.source === source && c.autoProvision)
      .map((c) => c.id),
  );
  if (autoIds.size === 0) return;
  const matchIds = get(workspaces)
    .filter((w) => {
      const md = w.metadata as Record<string, unknown> | undefined;
      if (md?.isDashboard !== true) return false;
      const contrib = md?.dashboardContributionId;
      return typeof contrib === "string" && autoIds.has(contrib);
    })
    .map((w) => w.id);
  for (const wsId of matchIds) {
    const idx = get(workspaces).findIndex((w) => w.id === wsId);
    if (idx >= 0) closeWorkspace(idx);
  }
}

/**
 * Locate the dashboard workspace for `groupId` + `contributionId` and
 * close it. Used by the Settings toggle UI and by MCP to remove a
 * dashboard contribution from a group.
 */
export function closeDashboardForGroup(
  groupId: string,
  contributionId: string,
): boolean {
  const match = get(workspaces).find((w) => {
    const md = w.metadata as Record<string, unknown> | undefined;
    return (
      md?.isDashboard === true &&
      md?.groupId === groupId &&
      md?.dashboardContributionId === contributionId
    );
  });
  if (!match) return false;
  const contribution = getDashboardContribution(contributionId);
  if (contribution?.autoProvision) return false;
  const idx = get(workspaces).findIndex((w) => w.id === match.id);
  if (idx < 0) return false;
  closeWorkspace(idx);
  return true;
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
    // One-shot cleanup: strip the legacy `## Active Agents` section
    // from the group's Overview markdown if it's still there. Runs
    // before we materialize / rebind the dashboard workspace so the
    // first render already reflects the cleaned file.
    await scrubGroupDashboardActiveAgents(groupDashboardPath(group.path));

    const matches = get(workspaces).filter((w) =>
      isGroupDashboardFor(w, group.id),
    );

    if (matches.length > 0) {
      const [keep, ...extras] = matches;
      if (keep && keep.id !== group.dashboardWorkspaceId) {
        updateWorkspaceGroup(group.id, { dashboardWorkspaceId: keep.id });
      }
      for (const dup of extras) {
        const idx = get(workspaces).findIndex((w) => w.id === dup.id);
        if (idx >= 0) closeWorkspace(idx);
      }
    }

    // Back-fill any autoProvision contribution (including `"group"` if
    // it is still missing after the dedupe pass, plus `"settings"` and
    // extension-owned autoProvision contributions).
    try {
      await provisionAutoDashboardsForGroup(group);
      // Rebind `dashboardWorkspaceId` if the group contribution was
      // just created by provision.
      const overview = get(workspaces).find((w) =>
        isGroupDashboardFor(w, group.id),
      );
      if (overview && overview.id !== group.dashboardWorkspaceId) {
        updateWorkspaceGroup(group.id, { dashboardWorkspaceId: overview.id });
      }
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
