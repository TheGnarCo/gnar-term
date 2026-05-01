/**
 * Workspace Service — CRUD + flow functions for the core
 * Workspace primitive. Relocated from the project-scope extension
 * in Stage 5; see ADR 004.
 *
 * Components and core commands call into this module rather than
 * touching the `workspacesStore` directly so state transitions
 * (adding to root-row order, claiming nestedWorkspaces, tearing down the
 * Dashboard workspace on delete) stay colocated with the store write.
 */
import { invoke } from "@tauri-apps/api/core";
import { get } from "svelte/store";
import type { SurfaceDef, Workspace } from "../config";
import { GROUP_COLOR_SLOTS } from "../../extensions/api";
import { appendRootRow, removeRootRow } from "../stores/root-row-order";
import {
  nestedWorkspaces,
  activeNestedWorkspaceIdx,
} from "../stores/workspace";
import { claimWorkspace, unclaimWorkspace } from "./claimed-workspace-registry";
import {
  getWorkspace,
  getWorkspaces,
  setActiveWorkspaceId,
  setWorkspaces,
} from "../stores/workspace-groups";
import {
  createNestedWorkspaceFromDef,
  closeNestedWorkspace,
  schedulePersist,
} from "./workspace-service";
import { eventBus } from "./event-bus";
import {
  getAllPanes,
  type NestedWorkspace,
  type NestedWorkspaceMetadata,
} from "../types";
import { wsMeta } from "./service-helpers";
import {
  getDashboardContribution,
  getDashboardContributions,
} from "./dashboard-contribution-registry";
import { releaseGroupDirtyStore } from "./group-git-dirty-store";

export const WORKSPACE_GROUP_STATE_CHANGED =
  "extension:workspace-group:state-changed";

function emitStateChanged(metadata: Record<string, unknown> = {}): void {
  eventBus.emit({
    type: WORKSPACE_GROUP_STATE_CHANGED,
    ...metadata,
  });
}

export function addWorkspace(group: Workspace): void {
  setWorkspaces([...getWorkspaces(), group]);
  appendRootRow({ kind: "workspace-group", id: group.id });
  emitStateChanged({ parentWorkspaceId: group.id });
}

export function updateWorkspace(
  id: string,
  patch: Partial<Omit<Workspace, "id">>,
): void {
  const next = getWorkspaces().map((g) =>
    g.id === id ? { ...g, ...patch } : g,
  );
  setWorkspaces(next);
  emitStateChanged({ parentWorkspaceId: id });
}

/**
 * Toggle the `locked` flag on a workspace group. Locked groups have
 * their drag-reorder, delete, and archive affordances suppressed.
 * No-op if no group with the given id exists.
 */
export function toggleWorkspaceLock(id: string): void {
  const groups = getWorkspaces();
  const idx = groups.findIndex((g) => g.id === id);
  if (idx === -1) return;
  const next = groups.map((g) =>
    g.id === id ? { ...g, locked: !g.locked } : g,
  );
  setWorkspaces(next);
  emitStateChanged({ parentWorkspaceId: id });
}

export function deleteWorkspace(id: string): void {
  const group = getWorkspace(id);
  if (group?.locked) return;
  const next = getWorkspaces().filter((g) => g.id !== id);
  setWorkspaces(next);
  removeRootRow({ kind: "workspace-group", id });
  if (group) releaseGroupDirtyStore(group.path);
  emitStateChanged({ parentWorkspaceId: id });
}

/**
 * All nestedWorkspaces tagged with `metadata.parentWorkspaceId === parentWorkspaceId`. This is the
 * canonical group-membership predicate for core operations (close sweeps,
 * reclaim, reconcile). Extension-layer consumers that need a CWD-prefix
 * fallback for unclaimed nestedWorkspaces should compose with this result.
 */
export function getWorktreeWorkspaces(
  parentWorkspaceId: string,
): NestedWorkspace[] {
  return get(nestedWorkspaces).filter(
    (w) => wsMeta(w).parentWorkspaceId === parentWorkspaceId,
  );
}

/**
 * Close every workspace tagged with `metadata.parentWorkspaceId === id`. Deletion
 * ripples through the nestedWorkspaces store, so we resolve each workspace by
 * id after recollecting the list. Dashboard nestedWorkspaces for the group
 * match the same predicate and are closed here too; callers should not
 * close the dashboard separately.
 */
function closeNestedWorkspaceById(wsId: string): void {
  const idx = get(nestedWorkspaces).findIndex((w) => w.id === wsId);
  if (idx >= 0) closeNestedWorkspace(idx);
}

export function closeNestedWorkspacesInWorkspace(id: string): void {
  for (const ws of getWorktreeWorkspaces(id)) closeNestedWorkspaceById(ws.id);
}

/**
 * Appends `workspaceId` to `parentWorkspaceId`'s workspaceIds if not already
 * present. No-op when the group is missing (e.g. was just deleted).
 * Returns true when a change was persisted.
 *
 * Enforces the single-primary invariant: throws if adding a non-worktree,
 * non-dashboard workspace to a group that already has a primaryWorkspaceId.
 */
export function addNestedWorkspaceToWorkspace(
  parentWorkspaceId: string,
  workspaceId: string,
): boolean {
  const groups = getWorkspaces();
  const group = groups.find((g) => g.id === parentWorkspaceId);
  if (!group) return false;
  if (group.workspaceIds.includes(workspaceId)) return false;

  // Enforce single-primary invariant.
  const incomingWs = get(nestedWorkspaces).find((w) => w.id === workspaceId);
  if (incomingWs) {
    const md = wsMeta(incomingWs);
    if (!md.worktreePath && !md.isDashboard && group.primaryWorkspaceId) {
      throw new Error(
        `Group "${parentWorkspaceId}" already has a primary workspace "${group.primaryWorkspaceId}". ` +
          `Cannot add a second non-worktree workspace "${workspaceId}".`,
      );
    }
  }

  const next = groups.map((g) => {
    if (g.id === parentWorkspaceId) {
      return { ...g, workspaceIds: [...g.workspaceIds, workspaceId] };
    }
    return g;
  });
  setWorkspaces(next);
  emitStateChanged({ parentWorkspaceId });
  return true;
}

/**
 * Inserts `workspaceId` into `parentWorkspaceId`'s workspaceIds at `positionInGroup`.
 * No-op when the group is missing or already contains the workspace.
 * Returns true when a change was persisted.
 */
export function insertWorkspaceIntoGroup(
  parentWorkspaceId: string,
  workspaceId: string,
  positionInGroup: number,
): boolean {
  const groups = getWorkspaces();
  let changed = false;
  const next = groups.map((g) => {
    if (g.id !== parentWorkspaceId) return g;
    if (g.workspaceIds.includes(workspaceId)) return g;
    changed = true;
    const ids = [...g.workspaceIds];
    ids.splice(
      Math.max(0, Math.min(ids.length, positionInGroup)),
      0,
      workspaceId,
    );
    return { ...g, workspaceIds: ids };
  });
  if (!changed) return false;
  setWorkspaces(next);
  emitStateChanged({ parentWorkspaceId });
  return true;
}

/**
 * Strips `workspaceId` from every group's workspaceIds. Used when a
 * workspace is closed — the group membership is inferred from workspace
 * metadata, so removing from all is cheap and idempotent.
 */
export function removeNestedWorkspaceFromAllWorkspaces(
  workspaceId: string,
): void {
  const next = getWorkspaces().map((g) => ({
    ...g,
    workspaceIds: g.workspaceIds.filter((id) => id !== workspaceId),
  }));
  setWorkspaces(next);
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

function buildGroupDashboardMarkdown(group: Workspace): string {
  // The Group Dashboard is the generic, agent-agnostic landing page for
  // a Workspace. It surfaces GitHub work-tracker context — open
  // issues + open PRs — side by side, as a passive read-only browse
  // panel. Spawn-on-issue lives on the per-group Agentic Dashboard tile
  // (which mounts the same `gnar:issues` widget without `displayOnly`).
  //
  // `gnar:columns`, `gnar:issues`, and `gnar:prs` are all registered by
  // the agentic extension. When that extension is disabled the markdown
  // previewer renders unknown widgets as a fallback, so the Dashboard
  // degrades gracefully for users who don't want agents.
  return `# ${group.name}

Project at \`${group.path}\`.

\`\`\`gnar:workspaces
\`\`\`

\`\`\`gnar:columns
children:
  - name: issues
    config:
      state: open
      displayOnly: true
  - name: prs
    config:
      state: open
\`\`\`
`;
}

/**
 * Write the Group Overview Dashboard markdown template to `path`.
 *
 * `force: true` overwrites any existing file — used by the
 * "Regenerate" action in Group Settings to refresh user-stale
 * templates after the seeded layout changes. The default skips the
 * write when a file is already present so first-create on an existing
 * group never trampling user customizations.
 */
async function writeGroupDashboardTemplate(
  group: Workspace,
  path: string,
  options: { force?: boolean } = {},
): Promise<void> {
  if (!options.force) {
    const exists = await invoke<boolean>("file_exists", { path }).catch(
      () => false,
    );
    if (exists) return;
  }
  const dir = path.replace(/\/[^/]+$/, "");
  await invoke("ensure_dir", { path: dir });
  await invoke("write_file", {
    path,
    content: buildGroupDashboardMarkdown(group),
  });
}

/**
 * Public regenerate hook for the Group Overview Dashboard
 * contribution. Force-rewrites the markdown at `groupDashboardPath`;
 * the preview surface watching that file picks up the change without
 * needing the workspace to be closed/recreated.
 */
export async function regenerateGroupDashboardTemplate(
  group: Workspace,
): Promise<void> {
  await writeGroupDashboardTemplate(group, groupDashboardPath(group.path), {
    force: true,
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

export async function migrateGroupDashboardWidgets(
  group: Workspace,
  path: string,
): Promise<void> {
  try {
    const exists = await invoke<boolean>("file_exists", { path }).catch(
      () => false,
    );
    if (!exists) return;
    const content = await invoke<string>("read_file", { path });
    if (content.includes("gnar:workspaces")) return;
    const marker = "```gnar:columns";
    const insert = "```gnar:workspaces\n```\n\n";
    const migrated = content.includes(marker)
      ? content.replace(marker, insert + marker)
      : insert + content;
    await invoke("write_file", { path, content: migrated });
  } catch (err) {
    console.warn(
      `[workspace-groups] Failed to migrate nestedWorkspaces widget into "${path}":`,
      err,
    );
  }
}

function createDashboardWorkspaceFromDef(
  group: Workspace,
  name: string,
  contribId: string,
  surfaces: SurfaceDef[],
): Promise<string> {
  return createNestedWorkspaceFromDef({
    name,
    layout: { pane: { surfaces } },
    metadata: {
      isDashboard: true,
      parentWorkspaceId: group.id,
      dashboardContributionId: contribId,
    },
  });
}

/**
 * Create the Dashboard workspace for a group: a constrained workspace
 * (metadata.isDashboard = true) hosting a single Live Preview of the
 * group's markdown file. Returns the new workspace id so the group
 * record can link to it.
 */
export async function createGroupDashboardWorkspace(
  group: Workspace,
): Promise<string> {
  const path = groupDashboardPath(group.path);
  try {
    await writeGroupDashboardTemplate(group, path);
  } catch {
    // Best-effort write — the workspace can still be created; the
    // preview surface will surface the backing-file error if relevant.
  }
  return createDashboardWorkspaceFromDef(group, "Dashboard", "group", [
    { type: "preview", path, name: group.name, focus: true },
  ]);
}

/**
 * Backfill `metadata.dashboardContributionId` on legacy dashboard
 * nestedWorkspaces that were created before the field existed. Without the
 * stamp, `hasDashboardWorkspace` (strict-match) misses the workspace
 * and `provisionAutoDashboardsForWorkspace` spawns a duplicate every
 * startup.
 *
 * Inference rules (preview-surface path-based):
 *   - backs the group's `project-dashboard.md` → `"group"`
 *   - backs the group's `.gnar-term/agentic-dashboard.md` → `"agentic"`
 *
 * Runs in a single nestedWorkspaces.update so subscribers see one state
 * transition. Idempotent: any workspace whose stamp is already set is
 * left alone.
 */
function backfillDashboardContributionIds(): void {
  const groups = getWorkspaces();
  if (groups.length === 0) return;
  const groupById = new Map<string, Workspace>();
  for (const g of groups) groupById.set(g.id, g);

  let mutated = false;
  nestedWorkspaces.update((list) => {
    const next = list.map((ws) => {
      const md = wsMeta(ws);
      if (md.isDashboard !== true) return ws;
      if (typeof md.dashboardContributionId === "string") return ws;
      const parentWorkspaceId = md.parentWorkspaceId;
      if (typeof parentWorkspaceId !== "string") return ws;
      const group = groupById.get(parentWorkspaceId);
      if (!group) return ws;

      const previewPaths = getAllPanes(ws.splitRoot)
        .flatMap((p) => p.surfaces)
        .filter(
          (s): s is { kind: "preview"; path: string } & typeof s =>
            s.kind === "preview",
        )
        .map((s) => s.path);

      let inferred: string | null = null;
      const groupPath = groupDashboardPath(group.path);
      const agenticPath = `${group.path.replace(/\/+$/, "")}/.gnar-term/agentic-dashboard.md`;
      if (previewPaths.includes(groupPath)) inferred = "group";
      else if (previewPaths.includes(agenticPath)) inferred = "agentic";
      if (!inferred) return ws;

      mutated = true;
      return {
        ...ws,
        metadata: {
          ...(ws.metadata ?? {}),
          dashboardContributionId: inferred,
        },
      };
    });
    return mutated ? next : list;
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
export function createSettingsDashboardWorkspace(
  group: Workspace,
): Promise<string> {
  return createDashboardWorkspaceFromDef(group, "Settings", "settings", []);
}

/**
 * Canonical predicate for group dashboard membership.
 *
 * - No `contribId` → matches any dashboard workspace for the group.
 * - `contribId` provided, `allowLegacyUndefined = false` → strict exact
 *   match (use for lookups where the contribution is known).
 * - `contribId` provided, `allowLegacyUndefined = true` → matches exact
 *   OR a workspace whose `dashboardContributionId` is still `undefined`
 *   (pre-stamp legacy records). Use for the group-overview reconcile pass.
 */
export function isDashboardWorkspace(
  ws: { metadata?: NestedWorkspaceMetadata },
  parentWorkspaceId: string,
  contribId?: string,
  allowLegacyUndefined = false,
): boolean {
  const md = ws.metadata;
  if (!md) return false;
  if (md.isDashboard !== true) return false;
  if (md.parentWorkspaceId !== parentWorkspaceId) return false;
  if (contribId === undefined) return true;
  const contribution = md.dashboardContributionId;
  if (allowLegacyUndefined) {
    return contribution === undefined || contribution === contribId;
  }
  return contribution === contribId;
}

export function findDashboardWorkspace(
  parentWorkspaceId: string,
  contribId: string,
) {
  return get(nestedWorkspaces).find((w) =>
    isDashboardWorkspace(w, parentWorkspaceId, contribId),
  );
}

/** True when a workspace exists for the given group + contribution pair. */
export function hasDashboardWorkspace(
  parentWorkspaceId: string,
  contribId: string,
): boolean {
  return get(nestedWorkspaces).some((w) =>
    isDashboardWorkspace(w, parentWorkspaceId, contribId),
  );
}

/**
 * Provision every registered `autoProvision` dashboard contribution for
 * `group`. Called after a group is created and on startup
 * reconciliation so auto-provision contributions (settings, agentic)
 * always have their workspace available. Idempotent — a contribution
 * already backed by a workspace is skipped.
 */
export async function provisionAutoDashboardsForWorkspace(
  group: Workspace,
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
  const matchIds = get(nestedWorkspaces)
    .filter((w) => {
      const md = wsMeta(w);
      if (md.isDashboard !== true) return false;
      const contrib = md.dashboardContributionId;
      return typeof contrib === "string" && autoIds.has(contrib);
    })
    .map((w) => w.id);
  for (const wsId of matchIds) closeNestedWorkspaceById(wsId);
}

/**
 * Locate the dashboard workspace for `parentWorkspaceId` + `contributionId` and
 * close it. Used by the Settings toggle UI and by MCP to remove a
 * dashboard contribution from a group.
 */
export function closeDashboardForGroup(
  parentWorkspaceId: string,
  contributionId: string,
): boolean {
  const match = findDashboardWorkspace(parentWorkspaceId, contributionId);
  if (!match) return false;
  const contribution = getDashboardContribution(contributionId);
  if (contribution?.autoProvision) return false;
  closeNestedWorkspaceById(match.id);
  return true;
}

/**
 * Switch to a group's Dashboard workspace. The Dashboard is created
 * eagerly on group creation, so this is a pure activation call.
 * Returns true on success.
 */
export function openWorkspaceDashboard(group: Workspace): boolean {
  const targetId = group.dashboardWorkspaceId;
  if (!targetId) return false;
  const idx = get(nestedWorkspaces).findIndex((w) => w.id === targetId);
  if (idx < 0) return false;
  activeNestedWorkspaceIdx.set(idx);
  return true;
}

/**
 * Close the Dashboard workspace backing `group` if it is currently
 * open. Used during group deletion so the workspace disappears
 * alongside the group record.
 */
export async function closeGroupDashboardWorkspace(
  group: Workspace,
): Promise<void> {
  const dashboardWsId = group.dashboardWorkspaceId;
  if (!dashboardWsId) return;
  closeNestedWorkspaceById(dashboardWsId);
}

/**
 * Called on app startup (after nestedWorkspaces are restored) — ensures every
 * group has exactly one Group Dashboard workspace. Prior releases
 * matched the dashboard via `group.dashboardWorkspaceId`; workspace
 * ids were unstable across restarts, so on every reload the lookup
 * missed and a fresh dashboard was spawned. The cleanup runs in three
 * passes:
 *
 *   1. Adopt the first workspace matching `metadata.isDashboard ===
 *      true && metadata.parentWorkspaceId === group.id` (with no contribution id,
 *      or an explicit `"group"` id) — rebinding the group's
 *      `dashboardWorkspaceId` to that workspace.
 *   2. Close every extra Group Dashboard for the same group (users end
 *      up with these when pre-fix state carried duplicates).
 *   3. Only when no dashboard exists at all, create a fresh one.
 *
 * The loop is sequential because `closeNestedWorkspace` mutates the
 * nestedWorkspaces store and ripples to `$activeNestedWorkspaceIdx`.
 */
export async function reconcileWorkspaceDashboards(): Promise<void> {
  // Backfill `dashboardContributionId` on restored legacy dashboards
  // so autoProvision's strict contribId match doesn't spawn duplicates.
  // Safe to call unconditionally — idempotent, early-returns when
  // nothing is inferable.
  backfillDashboardContributionIds();

  await Promise.allSettled(
    getWorkspaces().map(async (group) => {
      // One-shot cleanup: strip the legacy `## Active Agents` section
      // from the group's Overview markdown if it's still there. Runs
      // before we materialize / rebind the dashboard workspace so the
      // first render already reflects the cleaned file.
      await scrubGroupDashboardActiveAgents(groupDashboardPath(group.path));
      await migrateGroupDashboardWidgets(group, groupDashboardPath(group.path));

      // Deduplicate every autoProvision contribution type — keeps the first
      // match, closes the rest. Previously only "group" was covered; the
      // startup race could leave duplicate "settings" or extension-owned
      // dashboards (e.g. "agentic") that are now caught here too.
      for (const c of getDashboardContributions()) {
        if (!c.autoProvision) continue;
        const dupeMatches = get(nestedWorkspaces).filter((w) =>
          isDashboardWorkspace(w, group.id, c.id, true),
        );
        if (dupeMatches.length <= 1) continue;
        const [, ...extras] = dupeMatches;
        for (const dup of extras) closeNestedWorkspaceById(dup.id);
      }

      // Back-fill any autoProvision contribution (including `"group"` if
      // it is still missing after the dedupe pass, plus `"settings"` and
      // extension-owned autoProvision contributions).
      try {
        await provisionAutoDashboardsForWorkspace(group);
        // Rebind `dashboardWorkspaceId` to the current "group" overview —
        // either the one that survived dedupe or the one just provisioned.
        const overview = get(nestedWorkspaces).find((w) =>
          isDashboardWorkspace(w, group.id, "group", true),
        );
        if (overview && overview.id !== group.dashboardWorkspaceId) {
          updateWorkspace(group.id, { dashboardWorkspaceId: overview.id });
        }
      } catch (err) {
        console.warn(
          "[workspace-groups] Dashboard reconciliation failed:",
          err,
        );
      }
    }),
  );
}

/**
 * Re-claim nestedWorkspaces tagged with `metadata.parentWorkspaceId` that belong to a
 * known group. Called on app startup once groups are loaded and
 * nestedWorkspaces are restored — restoration creates fresh workspace ids so
 * we rebuild each group's workspaceIds list here.
 */
export function reclaimNestedWorkspacesAcrossWorkspaces(): void {
  const groups = getWorkspaces();
  const groupIds = new Set(groups.map((g) => g.id));

  // Collect workspace ids per group in a single pass to avoid one
  // setWorkspaces() call (and event emission) per workspace.
  const newMembers = new Map<string, string[]>();
  const toClaimIds: string[] = [];
  for (const ws of get(nestedWorkspaces)) {
    const parentWorkspaceId = wsMeta(ws).parentWorkspaceId;
    if (
      typeof parentWorkspaceId !== "string" ||
      !groupIds.has(parentWorkspaceId)
    )
      continue;
    const members = newMembers.get(parentWorkspaceId) ?? [];
    members.push(ws.id);
    newMembers.set(parentWorkspaceId, members);
    toClaimIds.push(ws.id);
  }

  if (newMembers.size > 0) {
    const next = groups.map((g) => {
      const toAdd = newMembers.get(g.id) ?? [];
      if (toAdd.length === 0) return g;
      const existing = new Set(g.workspaceIds);
      const fresh = toAdd.filter((id) => !existing.has(id));
      return fresh.length > 0
        ? { ...g, workspaceIds: [...g.workspaceIds, ...fresh] }
        : g;
    });
    setWorkspaces(next);
    emitStateChanged({});
  }

  for (const wsId of toClaimIds) claimWorkspace(wsId, "core");
}

/**
 * Startup reconciliation — called after nestedWorkspaces are restored.
 *
 * Pass 1: For every group lacking `primaryWorkspaceId`, select the first
 * member workspace that is neither a dashboard nor a worktree.
 *
 * Pass 2: Wrap every standalone workspace (no metadata.parentWorkspaceId, not a
 * dashboard) into a fresh group with that workspace as its primary.
 *
 * Idempotent — groups that already have `primaryWorkspaceId` are skipped.
 */
export async function reconcilePrimaryWorkspaces(): Promise<void> {
  // Pass 1 — backfill existing groups.
  for (const group of getWorkspaces()) {
    if (group.primaryWorkspaceId) continue;
    const members = getWorktreeWorkspaces(group.id);
    const primary = members.find(
      (w) => !wsMeta(w).worktreePath && !wsMeta(w).isDashboard,
    );
    if (primary) {
      updateWorkspace(group.id, { primaryWorkspaceId: primary.id });
    }
    // Groups with no eligible primary are left without one — the next
    // group creation flow will set it.
  }

  // Pass 2 — wrap standalone nestedWorkspaces.
  const knownGroupIds = new Set(getWorkspaces().map((g) => g.id));
  // Snapshot before we start mutating so the loop is stable.
  const snapshot = get(nestedWorkspaces);
  const usedColors = getWorkspaces().map((g) => g.color);

  for (const ws of snapshot) {
    const md = wsMeta(ws);
    if (md.parentWorkspaceId && knownGroupIds.has(md.parentWorkspaceId))
      continue;
    if (md.isDashboard) continue;
    // Orphan worktree nestedWorkspaces (group deleted, worktreePath still set) are
    // not primary candidates — skip them rather than wrapping them alone.
    if (md.worktreePath) continue;

    const colorIdx = usedColors.length % GROUP_COLOR_SLOTS.length;
    const color: string = GROUP_COLOR_SLOTS[colorIdx] ?? GROUP_COLOR_SLOTS[0];
    usedColors.push(color);

    const id = crypto.randomUUID();
    const group: Workspace = {
      id,
      name: ws.name,
      path: ((md as Record<string, unknown>).cwd as string) ?? "",
      color,
      workspaceIds: [ws.id],
      primaryWorkspaceId: ws.id,
      isGit: false,
      createdAt: new Date().toISOString(),
    };

    // Stamp the workspace with its new group and persist so the parentWorkspaceId
    // survives a restart — without this the workspace comes back as
    // standalone, fails the claim check, and gets wrapped again.
    nestedWorkspaces.update((list) =>
      list.map((w) =>
        w.id === ws.id
          ? { ...w, metadata: { ...(w.metadata ?? {}), parentWorkspaceId: id } }
          : w,
      ),
    );
    schedulePersist();
    addWorkspace(group);
    // onWorkspaceCreated already fired before reconcile runs, so claim here.
    claimWorkspace(ws.id, "core");
    knownGroupIds.add(id);
  }

  // Pass 3 — claim all nestedWorkspaces that have metadata.parentWorkspaceId pointing to
  // valid groups. This rehydrates the in-memory claim registry from
  // persisted metadata on restart.
  const validGroupIds = new Set(getWorkspaces().map((g) => g.id));
  for (const ws of get(nestedWorkspaces)) {
    const md = wsMeta(ws);
    if (md.parentWorkspaceId && validGroupIds.has(md.parentWorkspaceId)) {
      claimWorkspace(ws.id, "core");
    }
  }
}

/**
 * When a primary workspace is deleted, recreate it to maintain the invariant
 * that every group has exactly one non-worktree workspace.
 */
export function setupPrimaryWorkspaceAutoRecreation(): void {
  eventBus.on("workspace:closed", async (event) => {
    if (event.type !== "workspace:closed") return;
    const closedId = event.id;
    const group = getWorkspaces().find(
      (g) => g.primaryWorkspaceId === closedId,
    );
    if (!group) return; // Not a primary workspace

    // Recreate the primary workspace with the same name
    const newWsId = await createNestedWorkspaceFromDef({
      name: group.name,
      cwd: group.path,
      metadata: { parentWorkspaceId: group.id },
    });
    if (newWsId) {
      // Update the group's primary to the new workspace
      updateWorkspace(group.id, { primaryWorkspaceId: newWsId });
      claimWorkspace(newWsId, "core");
    }
  });
}

export {
  getWorkspace,
  getWorkspaces,
  setActiveWorkspaceId,
  unclaimWorkspace,
  claimWorkspace,
};
