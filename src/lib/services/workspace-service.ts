/**
 * Workspace Service — CRUD + flow functions for the core
 * Workspace primitive. Relocated from the project-scope extension
 * in Stage 5; see ADR 004.
 *
 * Components and core commands call into this module rather than
 * touching the `workspacesStore` directly so state transitions
 * (adding to root-row order, claiming workspaces, tearing down the
 * Dashboard workspace on delete) stay colocated with the store write.
 */
import { invoke } from "@tauri-apps/api/core";
import { get } from "svelte/store";
import type { SurfaceDef, WorkspaceRecord } from "../config";
import { WORKSPACE_COLOR_SLOTS } from "../../extensions/api";
import { appendRootRow, removeRootRow } from "../stores/root-row-order";
import { workspaces } from "../stores/workspace";
import { activeWorkspaceId } from "../stores/workspace";
import { claimWorkspace, unclaimWorkspace } from "./claimed-workspace-registry";
import {
  getWorkspace,
  getWorkspaces,
  setActiveWorkspaceId,
  setWorkspaces,
} from "../stores/workspaces";
import {
  createWorkspaceFromDef,
  closeWorkspace,
  schedulePersist,
  switchWorkspace,
} from "./workspace-runtime-service";
import { eventBus } from "./event-bus";
import { getAllPanes, type Workspace } from "../types";
import { wsMeta } from "./service-helpers";
import {
  getDashboardContribution,
  getDashboardContributions,
  OVERVIEW_DASHBOARD_CONTRIBUTION_ID,
} from "./dashboard-contribution-registry";
import { releaseWorkspaceDirtyStore } from "./workspace-git-dirty-store";

export const WORKSPACE_STATE_CHANGED = "extension:workspace:state-changed";

function emitStateChanged(metadata: Record<string, unknown> = {}): void {
  eventBus.emit({
    type: WORKSPACE_STATE_CHANGED,
    ...metadata,
  });
}

export function addWorkspace(workspace: WorkspaceRecord): void {
  setWorkspaces([...getWorkspaces(), workspace]);
  appendRootRow({ kind: "workspace", id: workspace.id });
  emitStateChanged({ parentWorkspaceId: workspace.id });
}

export function updateWorkspace(
  id: string,
  patch: Partial<Omit<WorkspaceRecord, "id">>,
): void {
  const next = getWorkspaces().map((w) =>
    w.id === id ? { ...w, ...patch } : w,
  );
  setWorkspaces(next);
  emitStateChanged({ parentWorkspaceId: id });
}

/**
 * Toggle the `locked` flag on a workspace. Locked workspaces have
 * their drag-reorder, delete, and archive affordances suppressed.
 * No-op if no workspace with the given id exists.
 */
export function toggleWorkspaceLock(id: string): void {
  const primaryWorkspaces = getWorkspaces();
  const idx = primaryWorkspaces.findIndex((w) => w.id === id);
  if (idx === -1) return;
  const next = primaryWorkspaces.map((w) =>
    w.id === id ? { ...w, locked: !w.locked } : w,
  );
  setWorkspaces(next);
  emitStateChanged({ parentWorkspaceId: id });
}

export function deleteWorkspace(id: string): void {
  const workspace = getWorkspace(id);
  if (workspace?.locked) return;
  const next = getWorkspaces().filter((w) => w.id !== id);
  setWorkspaces(next);
  removeRootRow({ kind: "workspace", id });
  if (workspace) releaseWorkspaceDirtyStore(workspace.path);
  emitStateChanged({ parentWorkspaceId: id });
}

/**
 * All workspaces tagged with `parentWorkspaceId === parentWorkspaceId`. This is the
 * canonical child-workspace-membership predicate for core operations (close
 * sweeps, reclaim, reconcile). Extension-layer consumers that need a
 * CWD-prefix fallback for unclaimed workspaces should compose with this
 * result.
 */
export function getChildrenOfWorkspace(parentWorkspaceId: string): Workspace[] {
  return get(workspaces).filter(
    (w) => wsMeta(w).parentWorkspaceId === parentWorkspaceId,
  );
}

/**
 * Close every workspace tagged with `metadata.parentWorkspaceId === id`. Deletion
 * ripples through the workspaces store, so we resolve each workspace by
 * id after recollecting the list. Dashboard workspaces for the workspace
 * match the same predicate and are closed here too; callers should not
 * close the dashboard separately.
 */
function closeWorkspaceById(wsId: string): void {
  const idx = get(workspaces).findIndex((w) => w.id === wsId);
  if (idx >= 0) closeWorkspace(idx);
}

export function closeWorkspacesInWorkspace(id: string): void {
  for (const ws of getChildrenOfWorkspace(id)) closeWorkspaceById(ws.id);
}

/**
 * Appends `workspaceId` to `parentWorkspaceId`'s child-id list if not already
 * present. No-op when the parent workspace is missing (e.g. was just deleted).
 * Returns true when a change was persisted.
 *
 * Enforces the single-primary invariant: throws if adding a non-worktree,
 * non-dashboard workspace to a parent that already has a primaryBranchedWorkspaceId.
 */
export function addChildToWorkspace(
  parentWorkspaceId: string,
  workspaceId: string,
): boolean {
  const primaryWorkspaces = getWorkspaces();
  const workspace = primaryWorkspaces.find((w) => w.id === parentWorkspaceId);
  if (!workspace) return false;
  if (workspace.branchedWorkspaceIds.includes(workspaceId)) return false;

  // Enforce single-primary invariant.
  const incomingWs = get(workspaces).find((w) => w.id === workspaceId);
  if (incomingWs) {
    const md = wsMeta(incomingWs);
    if (
      !md.worktreePath &&
      !md.isDashboard &&
      workspace.primaryBranchedWorkspaceId
    ) {
      throw new Error(
        `Workspace "${parentWorkspaceId}" already has a primary workspace "${workspace.primaryBranchedWorkspaceId}". ` +
          `Cannot add a second non-branched workspace "${workspaceId}".`,
      );
    }
  }

  const next = primaryWorkspaces.map((w) => {
    if (w.id === parentWorkspaceId) {
      return {
        ...w,
        branchedWorkspaceIds: [...w.branchedWorkspaceIds, workspaceId],
      };
    }
    return w;
  });
  setWorkspaces(next);
  emitStateChanged({ parentWorkspaceId });
  return true;
}

/**
 * Inserts `workspaceId` into `parentWorkspaceId`'s child-id list at `positionInWorkspace`.
 * No-op when the parent workspace is missing or already contains the child.
 * Returns true when a change was persisted.
 */
export function insertChildIntoWorkspace(
  parentWorkspaceId: string,
  workspaceId: string,
  positionInWorkspace: number,
): boolean {
  const workspaces = getWorkspaces();
  let changed = false;
  const next = workspaces.map((w) => {
    if (w.id !== parentWorkspaceId) return w;
    if (w.branchedWorkspaceIds.includes(workspaceId)) return w;
    changed = true;
    const ids = [...w.branchedWorkspaceIds];
    ids.splice(
      Math.max(0, Math.min(ids.length, positionInWorkspace)),
      0,
      workspaceId,
    );
    return { ...w, branchedWorkspaceIds: ids };
  });
  if (!changed) return false;
  setWorkspaces(next);
  emitStateChanged({ parentWorkspaceId });
  return true;
}

/**
 * Strips `workspaceId` from every parent workspace's child-id list. Used when a
 * child workspace is closed — child-membership is inferred from
 * `parentWorkspaceId`, so removing from all parents is cheap and idempotent.
 */
export function removeChildFromAllWorkspaces(workspaceId: string): void {
  const next = getWorkspaces().map((w) => ({
    ...w,
    branchedWorkspaceIds: w.branchedWorkspaceIds.filter(
      (id) => id !== workspaceId,
    ),
  }));
  setWorkspaces(next);
  emitStateChanged({});
}

/**
 * Path of the markdown file backing a workspace's Dashboard. Lives inside
 * the workspace's own `.gnar-term/` directory so multi-machine sync /
 * checkout follows the workspace itself.
 */
export function workspaceDashboardPath(workspacePath: string): string {
  return `${workspacePath.replace(/\/+$/, "")}/.gnar-term/project-dashboard.md`;
}

function buildWorkspaceDashboardMarkdown(workspace: WorkspaceRecord): string {
  // The Workspace Dashboard is the generic, agent-agnostic landing page for
  // a Workspace. It surfaces GitHub work-tracker context — open
  // issues + open PRs — side by side, as a passive read-only browse
  // panel. Spawn-on-issue lives on the per-workspace Agentic Dashboard tile
  // (which mounts the same `gnar:issues` widget without `displayOnly`).
  //
  // `gnar:columns`, `gnar:issues`, and `gnar:prs` are all registered by
  // the agentic extension. When that extension is disabled the markdown
  // previewer renders unknown widgets as a fallback, so the Dashboard
  // degrades gracefully for users who don't want agents.
  return `# ${workspace.name}

Project at \`${workspace.path}\`.

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
 * Write the Workspace Overview Dashboard markdown template to `path`.
 *
 * `force: true` overwrites any existing file — used by the
 * "Regenerate" action in Workspace Settings to refresh user-stale
 * templates after the seeded layout changes. The default skips the
 * write when a file is already present so first-create on an existing
 * workspace never trampling user customizations.
 */
async function writeWorkspaceDashboardTemplate(
  workspace: WorkspaceRecord,
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
    content: buildWorkspaceDashboardMarkdown(workspace),
  });
}

/**
 * Public regenerate hook for the Workspace Overview Dashboard
 * contribution. Force-rewrites the markdown at `workspaceDashboardPath`;
 * the preview surface watching that file picks up the change without
 * needing the workspace to be closed/recreated.
 */
export async function regenerateWorkspaceDashboardTemplate(
  workspace: WorkspaceRecord,
): Promise<void> {
  await writeWorkspaceDashboardTemplate(
    workspace,
    workspaceDashboardPath(workspace.path),
    {
      force: true,
    },
  );
}

/**
 * Remove the legacy `## Active Agents` section (heading + adjacent
 * `gnar:agent-list` fenced code block) from workspace Overview markdown.
 *
 * Older templates emitted this section into every workspace's
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

async function scrubWorkspaceDashboardActiveAgents(
  path: string,
): Promise<void> {
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
      `[workspace-service] Failed to scrub Active Agents from "${path}":`,
      err,
    );
  }
}

export async function migrateWorkspaceDashboardWidgets(
  workspace: WorkspaceRecord,
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
      `[workspace-service] Failed to migrate workspaces widget into "${path}":`,
      err,
    );
  }
}

function createDashboardWorkspaceFromDef(
  workspace: WorkspaceRecord,
  name: string,
  contribId: string,
  surfaces: SurfaceDef[],
): Promise<string> {
  return createWorkspaceFromDef({
    name,
    layout: { pane: { surfaces } },
    metadata: {
      isDashboard: true,
      parentWorkspaceId: workspace.id,
      dashboardContributionId: contribId,
    },
  });
}

/**
 * Create the Dashboard workspace for a workspace: a constrained workspace
 * (metadata.isDashboard = true) hosting a single Live Preview of the
 * workspace's markdown file. Returns the new workspace id so the workspace
 * record can link to it.
 */
export async function createWorkspaceDashboard(
  workspace: WorkspaceRecord,
): Promise<string> {
  const path = workspaceDashboardPath(workspace.path);
  try {
    await writeWorkspaceDashboardTemplate(workspace, path);
  } catch {
    // Best-effort write — the workspace can still be created; the
    // preview surface will surface the backing-file error if relevant.
  }
  return createDashboardWorkspaceFromDef(
    workspace,
    "Dashboard",
    OVERVIEW_DASHBOARD_CONTRIBUTION_ID,
    [{ type: "preview", path, name: workspace.name, focus: true }],
  );
}

/**
 * Backfill `metadata.dashboardContributionId` on legacy dashboard
 * workspaces that were created before the field existed. Without the
 * stamp, `hasDashboardWorkspace` (strict-match) misses the workspace
 * and `provisionAutoDashboardsForWorkspace` spawns a duplicate every
 * startup.
 *
 * Inference rules (preview-surface path-based):
 *   - backs the workspace's `project-dashboard.md` → `"group"`
 *
 * Other contribution types (e.g. agentic dashboards) own their own
 * stamping at creation time — the legacy path-based inference for
 * `.gnar-term/agentic-dashboard.md` was retired with the
 * Workspace→Workspace rename.
 *
 * Runs in a single workspaces.update so subscribers see one state
 * transition. Idempotent: any workspace whose stamp is already set is
 * left alone.
 */
function backfillDashboardContributionIds(): void {
  const primaryWorkspaces = getWorkspaces();
  if (primaryWorkspaces.length === 0) return;
  const workspaceById = new Map<string, WorkspaceRecord>();
  for (const g of primaryWorkspaces) workspaceById.set(g.id, g);

  let mutated = false;
  workspaces.update((list) => {
    const next = list.map((ws) => {
      const md = wsMeta(ws);
      if (md.isDashboard !== true) return ws;
      if (typeof md.dashboardContributionId === "string") return ws;
      const parentWorkspaceId = md.parentWorkspaceId;
      if (typeof parentWorkspaceId !== "string") return ws;
      const workspace = workspaceById.get(parentWorkspaceId);
      if (!workspace) return ws;

      const previewPaths = getAllPanes(ws.splitRoot)
        .flatMap((p) => p.surfaces)
        .filter(
          (s): s is { kind: "preview"; path: string } & typeof s =>
            s.kind === "preview",
        )
        .map((s) => s.path);

      let inferred: string | null = null;
      const workspacePath = workspaceDashboardPath(workspace.path);
      if (previewPaths.includes(workspacePath))
        inferred = OVERVIEW_DASHBOARD_CONTRIBUTION_ID;
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
 * Materialize the Settings dashboard workspace for a workspace — a
 * constrained dashboard (metadata.isDashboard = true,
 * dashboardContributionId = "settings") whose body PaneView renders as
 * the shared `<WorkspaceDashboardSettings>` component. The workspace carries
 * a single empty preview surface so it satisfies the workspace schema;
 * PaneView intercepts and replaces the surface render for settings
 * contributions.
 */
export function createSettingsDashboardWorkspace(
  workspace: WorkspaceRecord,
): Promise<string> {
  return createDashboardWorkspaceFromDef(workspace, "Settings", "settings", []);
}

/**
 * Canonical predicate for workspace dashboard membership.
 *
 * - No `contribId` → matches any dashboard workspace for the workspace.
 * - `contribId` provided, `allowLegacyUndefined = false` → strict exact
 *   match (use for lookups where the contribution is known).
 * - `contribId` provided, `allowLegacyUndefined = true` → matches exact
 *   OR a workspace whose `dashboardContributionId` is still `undefined`
 *   (pre-stamp legacy records). Use for the workspace-overview reconcile pass.
 */
export function isDashboardWorkspace(
  ws: WorkspaceRecord | import("../types").Workspace,
  parentWorkspaceId: string,
  contribId?: string,
  allowLegacyUndefined = false,
): boolean {
  const md = wsMeta(ws);
  if (md.isDashboard !== true) return false;
  if (md.parentWorkspaceId !== parentWorkspaceId) return false;
  if (contribId === undefined) return true;
  const contribution = md.dashboardContributionId;
  if (allowLegacyUndefined) {
    return contribution === undefined || contribution === contribId;
  }
  return contribution === contribId;
}

function findDashboardWorkspace(parentWorkspaceId: string, contribId: string) {
  return get(workspaces).find((w) =>
    isDashboardWorkspace(w, parentWorkspaceId, contribId),
  );
}

/** True when a workspace exists for the given workspace + contribution pair. */
function hasDashboardWorkspace(
  parentWorkspaceId: string,
  contribId: string,
): boolean {
  return get(workspaces).some((w) =>
    isDashboardWorkspace(w, parentWorkspaceId, contribId),
  );
}

/**
 * Provision every registered `autoProvision` dashboard contribution for
 * `workspace`. Called after a workspace is created and on startup
 * reconciliation so auto-provision contributions (settings, agentic)
 * always have their workspace available. Idempotent — a contribution
 * already backed by a workspace is skipped.
 *
 * `existingContribIds` is an optional precomputed set of contribution
 * ids already backed by a dashboard workspace for this parent. Pass it
 * to skip the per-call O(N) scan over child workspaces when the
 * caller has already built the snapshot (e.g. `reconcileWorkspaceDashboards`).
 */
export async function provisionAutoDashboardsForWorkspace(
  workspace: WorkspaceRecord,
  existingContribIds?: ReadonlySet<string>,
): Promise<void> {
  for (const c of getDashboardContributions()) {
    if (!c.autoProvision) continue;
    const exists = existingContribIds
      ? existingContribIds.has(c.id)
      : hasDashboardWorkspace(workspace.id, c.id);
    if (exists) continue;
    try {
      await c.create(workspace);
    } catch (err) {
      console.warn(
        `[workspace-service] auto-provision failed for "${c.id}":`,
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
      const md = wsMeta(w);
      if (md.isDashboard !== true) return false;
      const contrib = md.dashboardContributionId;
      return typeof contrib === "string" && autoIds.has(contrib);
    })
    .map((w) => w.id);
  for (const wsId of matchIds) closeWorkspaceById(wsId);
}

/**
 * Locate the dashboard workspace for `parentWorkspaceId` + `contributionId` and
 * close it. Used by the Settings toggle UI and by MCP to remove a
 * dashboard contribution from a workspace.
 */
export function closeDashboardForWorkspace(
  parentWorkspaceId: string,
  contributionId: string,
): boolean {
  const match = findDashboardWorkspace(parentWorkspaceId, contributionId);
  if (!match) return false;
  const contribution = getDashboardContribution(contributionId);
  if (contribution?.autoProvision) return false;
  closeWorkspaceById(match.id);
  return true;
}

/**
 * Switch to a workspace's Dashboard workspace. The Dashboard is created
 * eagerly on workspace creation, so this is a pure activation call.
 * Returns true on success.
 */
export function openWorkspaceDashboard(workspace: WorkspaceRecord): boolean {
  const targetId = workspace.dashboardWorkspaceId;
  if (!targetId) return false;
  const idx = get(workspaces).findIndex((w) => w.id === targetId);
  if (idx < 0) return false;
  activeWorkspaceId.set(targetId);
  return true;
}

/**
 * Activate a parent workspace: switch to its primary child workspace,
 * creating one if missing, or fall back to the dashboard / first child
 * workspace. Mirrors the WorkspaceSectionContent banner-click logic.
 */
export async function activateWorkspace(workspaceId: string): Promise<void> {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return;
  const ws = get(workspaces);
  // Prefer lastActiveBranchedWorkspaceId, fall back to primaryBranchedWorkspaceId
  const preferredId =
    workspace.lastActiveBranchedWorkspaceId ??
    workspace.primaryBranchedWorkspaceId;
  const preferredWs = preferredId
    ? ws.find((w) => w.id === preferredId)
    : undefined;
  if (preferredWs) {
    const idx = ws.indexOf(preferredWs);
    if (idx >= 0) {
      switchWorkspace(idx);
      return;
    }
  }
  // If the primary specifically is set but missing, recreate it.
  const primaryExists =
    workspace.primaryBranchedWorkspaceId &&
    ws.some((w) => w.id === workspace.primaryBranchedWorkspaceId);
  if (workspace.primaryBranchedWorkspaceId && !primaryExists) {
    const newWsId = await createWorkspaceFromDef({
      name: workspace.name,
      cwd: workspace.path,
      metadata: { parentWorkspaceId: workspace.id },
    });
    if (newWsId) {
      updateWorkspace(workspace.id, { primaryBranchedWorkspaceId: newWsId });
      claimWorkspace(newWsId, "core");
      const newIdx = get(workspaces).findIndex((w) => w.id === newWsId);
      if (newIdx >= 0) switchWorkspace(newIdx);
      return;
    }
  }
  if (openWorkspaceDashboard(workspace)) return;
  const allWs = get(workspaces);
  const branchedIdx = allWs.findIndex(
    (w) => wsMeta(w)?.parentWorkspaceId === workspace.id,
  );
  if (branchedIdx >= 0) switchWorkspace(branchedIdx);
}

/**
 * Called on app startup (after workspaces are restored) — ensures every
 * workspace has exactly one Dashboard Workspace. Prior releases
 * matched the dashboard via `workspace.dashboardWorkspaceId`; child workspace
 * ids were unstable across restarts, so on every reload the lookup
 * missed and a fresh dashboard was spawned. The cleanup runs in three
 * passes:
 *
 *   1. Adopt the first workspace matching `metadata.isDashboard ===
 *      true && metadata.parentWorkspaceId === workspace.id` (with no contribution id,
 *      or an explicit `OVERVIEW_DASHBOARD_CONTRIBUTION_ID` id) — rebinding the workspace's
 *      `dashboardWorkspaceId` to that workspace.
 *   2. Close every extra Workspace Dashboard for the same workspace (users end
 *      up with these when pre-fix state carried duplicates).
 *   3. Only when no dashboard exists at all, create a fresh one.
 *
 * The loop is sequential because `closeWorkspace` mutates the
 * workspaces store and ripples to `$activeWorkspaceIdx`.
 */
async function reconcileDashboardsForWorkspace(
  workspace: WorkspaceRecord,
  dashboardIndex: Map<string, Map<string, Workspace[]>>,
): Promise<void> {
  // One-shot cleanup: strip the legacy `## Active Agents` section
  // from the workspace's Overview markdown if it's still there. Runs
  // before we materialize / rebind the dashboard workspace so the
  // first render already reflects the cleaned file.
  await scrubWorkspaceDashboardActiveAgents(
    workspaceDashboardPath(workspace.path),
  );
  await migrateWorkspaceDashboardWidgets(
    workspace,
    workspaceDashboardPath(workspace.path),
  );

  const byContrib = dashboardIndex.get(workspace.id);

  // Deduplicate every autoProvision contribution type — keeps the first
  // match, closes the rest. Previously only "group" was covered; the
  // startup race could leave duplicate "settings" or extension-owned
  // dashboards (e.g. "agentic") that are now caught here too.
  for (const c of getDashboardContributions()) {
    if (!c.autoProvision) continue;
    const dupeMatches = byContrib?.get(c.id) ?? [];
    if (dupeMatches.length <= 1) continue;
    const [keep, ...extras] = dupeMatches;
    for (const dup of extras) closeWorkspaceById(dup.id);
    // Prune the index to mirror the store mutation; the post-dedupe
    // `existingContribIds` snapshot below relies on this.
    if (keep) byContrib?.set(c.id, [keep]);
  }

  // Back-fill any autoProvision contribution (including OVERVIEW_DASHBOARD_CONTRIBUTION_ID if
  // it is still missing after the dedupe pass, plus `"settings"` and
  // extension-owned autoProvision contributions).
  try {
    const existingContribIds = new Set(byContrib?.keys() ?? []);
    await provisionAutoDashboardsForWorkspace(workspace, existingContribIds);
    // Rebind `dashboardWorkspaceId` to the current OVERVIEW_DASHBOARD_CONTRIBUTION_ID overview —
    // either the one that survived dedupe or the one just provisioned.
    // Check the index first (O(1)); fall back to a store scan only for
    // dashboards provisioned after the index was built.
    const overview =
      byContrib?.get(OVERVIEW_DASHBOARD_CONTRIBUTION_ID)?.[0] ??
      get(workspaces).find((w) =>
        isDashboardWorkspace(
          w,
          workspace.id,
          OVERVIEW_DASHBOARD_CONTRIBUTION_ID,
          true,
        ),
      );
    if (overview && overview.id !== workspace.dashboardWorkspaceId) {
      updateWorkspace(workspace.id, {
        dashboardWorkspaceId: overview.id,
      });
    }
  } catch (err) {
    console.warn("[workspace-service] Dashboard reconciliation failed:", err);
  }
}

export async function reconcileWorkspaceDashboards(): Promise<void> {
  // Backfill `dashboardContributionId` on restored legacy dashboards
  // so autoProvision's strict contribId match doesn't spawn duplicates.
  // Safe to call unconditionally — idempotent, early-returns when
  // nothing is inferable.
  backfillDashboardContributionIds();

  // Single pass over workspaces builds an index keyed by
  // (parentId → contribId → matching workspaces). Without it, each
  // workspace × autoProvision-contribution iteration would scan the full
  // workspaces list (W*C cold-start cost). The index is mutated
  // in lock-step with closeWorkspaceById below so the dedupe pass
  // and the post-dedupe `existingContribIds` snapshot stay in sync.
  const dashboardIndex = new Map<string, Map<string, Workspace[]>>();
  for (const w of get(workspaces)) {
    const md = wsMeta(w);
    if (md.isDashboard !== true) continue;
    const parentId = md.parentWorkspaceId;
    if (typeof parentId !== "string") continue;
    const contribId = md.dashboardContributionId;
    if (typeof contribId !== "string") continue;
    let byContrib = dashboardIndex.get(parentId);
    if (!byContrib) {
      byContrib = new Map();
      dashboardIndex.set(parentId, byContrib);
    }
    const list = byContrib.get(contribId) ?? [];
    list.push(w);
    byContrib.set(contribId, list);
  }

  await Promise.allSettled(
    getWorkspaces().map((workspace) =>
      reconcileDashboardsForWorkspace(workspace, dashboardIndex),
    ),
  );
}

/**
 * Re-claim workspaces tagged with `metadata.parentWorkspaceId` that belong to a
 * known workspace. Called on app startup once workspaces are loaded and
 * workspaces are restored — restoration creates fresh workspace ids so
 * we rebuild each workspace's branchedWorkspaceIds list here.
 */
export function reclaimChildWorkspaces(): void {
  const primaryWorkspaces = getWorkspaces();
  const workspaceIds = new Set(primaryWorkspaces.map((w) => w.id));

  // Collect workspace ids per workspace in a single pass to avoid one
  // setWorkspaces() call (and event emission) per workspace.
  const newMembers = new Map<string, string[]>();
  const toClaimIds: string[] = [];
  for (const ws of get(workspaces)) {
    const parentWorkspaceId = wsMeta(ws).parentWorkspaceId;
    if (
      typeof parentWorkspaceId !== "string" ||
      !workspaceIds.has(parentWorkspaceId)
    )
      continue;
    const members = newMembers.get(parentWorkspaceId) ?? [];
    members.push(ws.id);
    newMembers.set(parentWorkspaceId, members);
    toClaimIds.push(ws.id);
  }

  if (newMembers.size > 0) {
    const next = primaryWorkspaces.map((w) => {
      const toAdd = newMembers.get(w.id) ?? [];
      if (toAdd.length === 0) return w;
      const existing = new Set(w.branchedWorkspaceIds);
      const fresh = toAdd.filter((id) => !existing.has(id));
      return fresh.length > 0
        ? { ...w, branchedWorkspaceIds: [...w.branchedWorkspaceIds, ...fresh] }
        : w;
    });
    setWorkspaces(next);
    emitStateChanged({});
  }

  for (const wsId of toClaimIds) claimWorkspace(wsId, "core");
}

function backfillPrimaryWorkspaces(): void {
  for (const workspace of getWorkspaces()) {
    if (workspace.primaryBranchedWorkspaceId) continue;
    const members = getChildrenOfWorkspace(workspace.id);
    const primary = members.find(
      (w) => !wsMeta(w).worktreePath && !wsMeta(w).isDashboard,
    );
    if (primary) {
      updateWorkspace(workspace.id, { primaryBranchedWorkspaceId: primary.id });
    }
    // Workspaces with no eligible primary are left without one — the next
    // child-workspace creation flow will set it.
  }
}

function wrapStandaloneChildWorkspaces(): void {
  const knownWorkspaceIds = new Set(getWorkspaces().map((w) => w.id));
  // Snapshot before we start mutating so the loop is stable.
  const snapshot = get(workspaces);
  const usedColors = getWorkspaces().map((w) => w.color);

  for (const ws of snapshot) {
    const md = wsMeta(ws);
    if (md.parentWorkspaceId && knownWorkspaceIds.has(md.parentWorkspaceId))
      continue;
    if (md.isDashboard) continue;
    // Orphan branched workspaces (workspace deleted, worktreePath still set) are
    // not primary candidates — skip them rather than wrapping them alone.
    if (md.worktreePath) continue;

    const colorIdx = usedColors.length % WORKSPACE_COLOR_SLOTS.length;
    const color: string =
      WORKSPACE_COLOR_SLOTS[colorIdx] ?? WORKSPACE_COLOR_SLOTS[0];
    usedColors.push(color);

    const rawCwd = (md as Record<string, unknown>).cwd;
    const path = typeof rawCwd === "string" && rawCwd ? rawCwd : "~";

    const id = crypto.randomUUID();
    const workspace: WorkspaceRecord = {
      id,
      name: ws.name,
      path,
      color,
      branchedWorkspaceIds: [ws.id],
      primaryBranchedWorkspaceId: ws.id,
      isGit: false,
      createdAt: new Date().toISOString(),
    };

    // Stamp the workspace with its new workspace and persist so the parentWorkspaceId
    // survives a restart — without this the workspace comes back as
    // standalone, fails the claim check, and gets wrapped again.
    workspaces.update((list) =>
      list.map((w) =>
        w.id === ws.id
          ? { ...w, metadata: { ...(w.metadata ?? {}), parentWorkspaceId: id } }
          : w,
      ),
    );
    schedulePersist();
    addWorkspace(workspace);
    // onWorkspaceCreated already fired before reconcile runs, so claim here.
    claimWorkspace(ws.id, "core");
    knownWorkspaceIds.add(id);
  }
}

function rehydrateClaimRegistry(): void {
  // Claim all workspaces that have metadata.parentWorkspaceId pointing to
  // valid workspaces. This rehydrates the in-memory claim registry from
  // persisted metadata on restart.
  const validWorkspaceIds = new Set(getWorkspaces().map((w) => w.id));
  for (const ws of get(workspaces)) {
    const md = wsMeta(ws);
    if (md.parentWorkspaceId && validWorkspaceIds.has(md.parentWorkspaceId)) {
      claimWorkspace(ws.id, "core");
    }
  }
}

/**
 * Startup reconciliation — called after workspaces are restored.
 *
 * Pass 1: For every workspace lacking `primaryBranchedWorkspaceId`, select the first
 * member workspace that is neither a dashboard nor a worktree.
 *
 * Pass 2: Wrap every standalone workspace (no metadata.parentWorkspaceId, not a
 * dashboard) into a fresh workspace with that workspace as its primary.
 *
 * Pass 3: Rehydrate the in-memory claim registry from persisted parentWorkspaceId
 * metadata so claimed workspaces survive restarts.
 *
 * Idempotent — workspaces that already have `primaryBranchedWorkspaceId` are skipped.
 */
export async function reconcilePrimaryWorkspaces(): Promise<void> {
  backfillPrimaryWorkspaces();
  wrapStandaloneChildWorkspaces();
  rehydrateClaimRegistry();
}

/**
 * Stamp `pathMissing: true` on any workspace whose `path` no longer
 * exists on disk (e.g. the user deleted the directory between sessions
 * or moved a worktree out from under the app). The flag is runtime-only
 * — not persisted — and is re-derived on every startup. Sidebar
 * components surface a "path missing" affordance when the flag is set.
 *
 * Best-effort: a failing `file_exists` invoke is treated as "not
 * missing" so a transient FS error doesn't paint every workspace red.
 * Idempotent: a workspace whose path now exists has its flag cleared on
 * the next sweep.
 */
export async function validateWorkspaceRootPaths(): Promise<void> {
  const workspaces = getWorkspaces();
  for (const workspace of workspaces) {
    let exists = true;
    try {
      exists = await invoke<boolean>("file_exists", { path: workspace.path });
    } catch {
      exists = true;
    }
    const missing = !exists;
    if ((workspace.pathMissing ?? false) !== missing) {
      updateWorkspace(workspace.id, { pathMissing: missing });
    }
  }
}

/**
 * When a primary workspace is deleted, recreate it to maintain the invariant
 * that every workspace has exactly one non-branched workspace.
 */
export function setupPrimaryWorkspaceAutoRecreation(): void {
  eventBus.on("workspace:closed", async (event) => {
    if (event.type !== "workspace:closed") return;
    const closedId = event.id;
    const workspace = getWorkspaces().find(
      (w) => w.primaryBranchedWorkspaceId === closedId,
    );
    if (!workspace) return; // Not a primary workspace

    // Recreate the primary workspace with the same name
    const newWsId = await createWorkspaceFromDef({
      name: workspace.name,
      cwd: workspace.path,
      metadata: { parentWorkspaceId: workspace.id },
    });
    if (newWsId) {
      // Update the workspace's primary to the new workspace
      updateWorkspace(workspace.id, { primaryBranchedWorkspaceId: newWsId });
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
