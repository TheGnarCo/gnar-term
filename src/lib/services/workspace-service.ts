/**
 * Workspace Service — CRUD + flow functions for the core
 * Workspace primitive; see ADR 004.
 *
 * Components and core commands call into this module rather than
 * touching the `workspacesStore` directly so state transitions
 * (adding to root-row order, attaching branches/dashboards, tearing
 * down the Dashboard workspace on delete) stay colocated with the
 * store write.
 */
import { invoke } from "@tauri-apps/api/core";
import { get } from "svelte/store";
import type { SurfaceDef } from "../config";
import type { RootWorkspace } from "../stores/workspace";
import { WORKSPACE_COLOR_SLOTS } from "../../extensions/api";
import { appendRootRow, removeRootRow } from "../stores/root-row-order";
import { workspaces } from "../stores/workspace";
import { activeWorkspaceId } from "../stores/workspace";
import {
  getWorkspace,
  getWorkspaces,
  setActiveWorkspaceId,
  setWorkspaces,
} from "../stores/workspace";
import {
  createWorkspaceFromDef,
  closeWorkspace,
  switchWorkspace,
} from "./workspace-runtime-service";
import { schedulePersist } from "./workspace-persist";
import { eventBus } from "./event-bus";
import { type Workspace } from "../types";
import {
  getDashboardContribution,
  getDashboardContributions,
  OVERVIEW_DASHBOARD_CONTRIBUTION_ID,
} from "./dashboard-contribution-registry";
import { globalSurfaceTypeId } from "./global-surface-service";
import { releaseWorkspaceDirtyStore } from "./workspace-git-dirty-store";

export const WORKSPACE_STATE_CHANGED = "extension:workspace:state-changed";

function emitStateChanged(metadata: Record<string, unknown> = {}): void {
  eventBus.emit({
    type: WORKSPACE_STATE_CHANGED,
    ...metadata,
  });
}

export function addWorkspace(workspace: RootWorkspace): void {
  // Every entry in the unified store is a `Workspace`, so even a
  // record-shaped row needs a paneLayout. When the caller hasn't
  // materialized a tab surface yet, mint a placeholder empty pane —
  // `createWorkspaceFromDef` will overwrite paneLayout / activePaneId
  // when the matching runtime workspace is created.
  const ensured: RootWorkspace = {
    ...workspace,
    paneLayout: workspace.paneLayout ?? {
      type: "pane",
      pane: {
        id: `placeholder-${workspace.id}`,
        surfaces: [],
        activeSurfaceId: null,
      },
    },
    activePaneId: workspace.activePaneId ?? null,
  };
  setWorkspaces([...getWorkspaces(), ensured]);
  appendRootRow({ kind: "workspace", id: workspace.id });
  emitStateChanged({ workspaceId: workspace.id });
  schedulePersist();
}

export function updateWorkspace(
  id: string,
  patch: Partial<Omit<RootWorkspace, "id">>,
): void {
  const next = getWorkspaces().map((w) =>
    w.id === id ? { ...w, ...patch } : w,
  );
  setWorkspaces(next);
  emitStateChanged({ workspaceId: id });
  schedulePersist();
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
  emitStateChanged({ workspaceId: id });
  schedulePersist();
}

export function deleteWorkspace(id: string): void {
  const workspace = getWorkspace(id);
  if (workspace?.locked) return;
  const next = getWorkspaces().filter((w) => w.id !== id);
  setWorkspaces(next);
  removeRootRow({ kind: "workspace", id });
  if (workspace) releaseWorkspaceDirtyStore(workspace.path);
  emitStateChanged({ workspaceId: id });
  schedulePersist();
}

/**
 * All Branches tagged with `ws.rootWorkspaceId === rootWorkspaceId`. This is the
 * canonical Branch-membership predicate for core operations (close
 * sweeps, membership rebuild, reconcile). Extension-layer consumers
 * that need a CWD-prefix fallback for unattached workspaces should
 * compose with this result.
 */
export function getBranchesOfWorkspace(rootWorkspaceId: string): Workspace[] {
  return get(workspaces).filter((w) => w.rootWorkspaceId === rootWorkspaceId);
}

/**
 * Close every workspace tagged with `rootWorkspaceId === id`. Deletion
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
  for (const ws of getBranchesOfWorkspace(id)) closeWorkspaceById(ws.id);
}

/**
 * Appends `workspaceId` to `rootWorkspaceId`'s Branch-id list if not already
 * present. No-op when the root workspace is missing (e.g. was just deleted).
 * Returns true when a change was persisted.
 */
export function addBranchToWorkspace(
  rootWorkspaceId: string,
  workspaceId: string,
): boolean {
  const primaryWorkspaces = getWorkspaces();
  const workspace = primaryWorkspaces.find((w) => w.id === rootWorkspaceId);
  if (!workspace) return false;
  if ((workspace.branchedWorkspaceIds ?? []).includes(workspaceId))
    return false;

  const next = primaryWorkspaces.map((w) => {
    if (w.id === rootWorkspaceId) {
      return {
        ...w,
        branchedWorkspaceIds: [...(w.branchedWorkspaceIds ?? []), workspaceId],
      };
    }
    return w;
  });
  setWorkspaces(next);
  emitStateChanged({ rootWorkspaceId });
  schedulePersist();
  return true;
}

/**
 * Strips `workspaceId` from every Workspace's `branchedWorkspaceIds`
 * list. Used when a Branch is closed — Branch membership is derived
 * from `rootWorkspaceId`, so the sweep is cheap and idempotent.
 */
export function removeBranchFromAllWorkspaces(workspaceId: string): void {
  const next = getWorkspaces().map((w) => ({
    ...w,
    branchedWorkspaceIds: (w.branchedWorkspaceIds ?? []).filter(
      (id) => id !== workspaceId,
    ),
  }));
  setWorkspaces(next);
  emitStateChanged({});
  schedulePersist();
}

function createDashboardWorkspaceFromDef(
  workspace: RootWorkspace,
  name: string,
  contribId: string,
  surfaces: SurfaceDef[],
): Promise<string> {
  return createWorkspaceFromDef({
    name,
    layout: { pane: { surfaces } },
    isDashboard: true,
    rootWorkspaceId: workspace.id,
    dashboardContributionId: contribId,
  });
}

/**
 * Create the Workspace Overview Dashboard for a workspace. Seeds a
 * single hidden dashboard surface (`dashboard:group`) registered by
 * `init-workspaces` against `WorkspaceOverviewBody`; the standard pane
 * render path mounts it, so TabBar / split affordances work like any
 * other workspace. `rootWorkspaceId` is forwarded via `extensionProps`
 * so the body can project it into a DashboardHostContext for embedded
 * widgets (Issues, PRs, WorkspacesWidget).
 */
export async function createWorkspaceDashboard(
  workspace: RootWorkspace,
): Promise<string> {
  return createDashboardWorkspaceFromDef(
    workspace,
    "Dashboard",
    OVERVIEW_DASHBOARD_CONTRIBUTION_ID,
    [
      {
        type: "registry",
        extensionType: globalSurfaceTypeId(OVERVIEW_DASHBOARD_CONTRIBUTION_ID),
        extensionProps: { rootWorkspaceId: workspace.id },
        name: "Dashboard",
        focus: true,
      },
    ],
  );
}

/**
 * Materialize the Settings dashboard workspace for a workspace — a
 * constrained dashboard (metadata.isDashboard = true,
 * dashboardContributionId = "settings") that seeds a single
 * `core:workspace-settings` registry surface. The standard pane render
 * path mounts `WorkspaceDashboardSettings`, so TabBar / split affordances
 * work uniformly with every other dashboard.
 */
export function createSettingsDashboardWorkspace(
  workspace: RootWorkspace,
): Promise<string> {
  return createDashboardWorkspaceFromDef(workspace, "Settings", "settings", [
    {
      type: "registry",
      extensionType: "core:workspace-settings",
      extensionProps: { rootWorkspaceId: workspace.id },
      name: "Settings",
      focus: true,
    },
  ]);
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
  ws: import("../types").Workspace,
  rootWorkspaceId: string,
  contribId?: string,
  allowLegacyUndefined = false,
): boolean {
  if (ws.isDashboard !== true) return false;
  if (ws.rootWorkspaceId !== rootWorkspaceId) return false;
  if (contribId === undefined) return true;
  const contribution = ws.dashboardContributionId;
  if (allowLegacyUndefined) {
    return contribution === undefined || contribution === contribId;
  }
  return contribution === contribId;
}

function findDashboardWorkspace(rootWorkspaceId: string, contribId: string) {
  return get(workspaces).find((w) =>
    isDashboardWorkspace(w, rootWorkspaceId, contribId),
  );
}

/** True when a workspace exists for the given workspace + contribution pair. */
function hasDashboardWorkspace(
  rootWorkspaceId: string,
  contribId: string,
): boolean {
  return get(workspaces).some((w) =>
    isDashboardWorkspace(w, rootWorkspaceId, contribId),
  );
}

/**
 * Provision every registered auto-provisioning dashboard contribution
 * for `workspace`. Called after a workspace is created and on startup
 * reconciliation so:
 *
 *   - `autoProvision` contributions (settings) — always materialize.
 *   - `defaultEnabled` contributions (diff, agentic) — materialize unless
 *     the workspace's `dismissedDashboardContributionIds` lists them, so
 *     a user-removed default-on dashboard does not come back on reconcile.
 *
 * Idempotent — a contribution already backed by a workspace is skipped.
 *
 * `existingContribIds` is an optional precomputed set of contribution
 * ids already backed by a dashboard workspace for this parent. Pass it
 * to skip the per-call O(N) scan over child workspaces when the
 * caller has already built the snapshot (e.g. `reconcileWorkspaceDashboards`).
 */
export async function provisionAutoDashboardsForWorkspace(
  workspace: RootWorkspace,
  existingContribIds?: ReadonlySet<string>,
): Promise<void> {
  const dismissed = new Set(workspace.dismissedDashboardContributionIds ?? []);
  for (const c of getDashboardContributions()) {
    if (!c.autoProvision && !c.defaultEnabled) continue;
    // autoProvision is locked-on; defaultEnabled honors the per-workspace
    // dismissal list.
    if (!c.autoProvision && dismissed.has(c.id)) continue;
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
      if (w.isDashboard !== true) return false;
      const contrib = w.dashboardContributionId;
      return typeof contrib === "string" && autoIds.has(contrib);
    })
    .map((w) => w.id);
  for (const wsId of matchIds) closeWorkspaceById(wsId);
}

/**
 * Locate the dashboard workspace for `rootWorkspaceId` + `contributionId` and
 * close it. Used by the Settings toggle UI and by MCP to remove a
 * dashboard contribution from a workspace.
 *
 * Records a dismissal for `defaultEnabled` contributions so the next
 * reconcile pass does not recreate the dashboard. `autoProvision`
 * contributions are locked-on and refuse to close.
 */
export function closeDashboardForWorkspace(
  rootWorkspaceId: string,
  contributionId: string,
): boolean {
  const contribution = getDashboardContribution(contributionId);
  if (contribution?.autoProvision) return false;
  if (contribution?.defaultEnabled) {
    recordDashboardDismissal(rootWorkspaceId, contributionId);
  }
  const match = findDashboardWorkspace(rootWorkspaceId, contributionId);
  if (!match) return false;
  closeWorkspaceById(match.id);
  return true;
}

/**
 * Append `contributionId` to the workspace's
 * `dismissedDashboardContributionIds` so future reconciliation passes do
 * not re-provision the dashboard. Idempotent — duplicates are coalesced.
 * No-op when the workspace has no matching root entry.
 */
export function recordDashboardDismissal(
  rootWorkspaceId: string,
  contributionId: string,
): void {
  const ws = getWorkspace(rootWorkspaceId);
  if (!ws) return;
  const current = ws.dismissedDashboardContributionIds ?? [];
  if (current.includes(contributionId)) return;
  updateWorkspace(rootWorkspaceId, {
    dismissedDashboardContributionIds: [...current, contributionId],
  });
}

/**
 * Remove `contributionId` from the workspace's dismissal list. Called
 * when the user re-enables a previously dismissed `defaultEnabled`
 * contribution from Workspace Settings, so the next provisioning pass
 * (or the immediate `create()` in the toggle handler) is the only
 * source of truth for the dashboard's lifecycle. No-op when the id
 * isn't present in the list.
 */
export function clearDashboardDismissal(
  rootWorkspaceId: string,
  contributionId: string,
): void {
  const ws = getWorkspace(rootWorkspaceId);
  if (!ws) return;
  const current = ws.dismissedDashboardContributionIds ?? [];
  if (!current.includes(contributionId)) return;
  const next = current.filter((id) => id !== contributionId);
  updateWorkspace(rootWorkspaceId, {
    dismissedDashboardContributionIds: next.length > 0 ? next : undefined,
  });
}

/**
 * Switch to a workspace's Dashboard workspace. The Dashboard is created
 * eagerly on workspace creation, so this is a pure activation call.
 * Returns true on success.
 */
export function openWorkspaceDashboard(workspace: RootWorkspace): boolean {
  const targetId = workspace.dashboardWorkspaceId;
  if (!targetId) return false;
  const idx = get(workspaces).findIndex((w) => w.id === targetId);
  if (idx < 0) return false;
  activeWorkspaceId.set(targetId);
  return true;
}

/**
 * Activate a Workspace by id: land on its own Root tab surface — the
 * runtime Workspace whose id matches the Workspace's record id (ADR-004).
 *
 * Row click and ⌘1-9 both flow through here. We deliberately ignore
 * `lastActiveBranchedWorkspaceId` — that field tracks the most-recent
 * Branch for the "jump to active branch" affordance, not for routing
 * row activations. Branches and Dashboards are reached by clicking
 * their own rows / dashboard tiles, not via the Workspace row.
 *
 * If the Root runtime Workspace is missing (deleted, never restored, or
 * a stale persisted id), materialize it with the record id so the row
 * always lands on its own tabs. We never fall through to the dashboard
 * or a branch — the Workspace's own surface is the canonical landing.
 */
export async function activateWorkspace(workspaceId: string): Promise<void> {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return;
  const existingIdx = get(workspaces).findIndex((w) => w.id === workspace.id);
  if (existingIdx >= 0) {
    switchWorkspace(existingIdx);
    return;
  }
  const rootId = await createWorkspaceFromDef({
    id: workspace.id,
    name: workspace.name,
    cwd: workspace.path,
  });
  if (!rootId) return;
  const newIdx = get(workspaces).findIndex((w) => w.id === rootId);
  if (newIdx >= 0) switchWorkspace(newIdx);
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
 *      true && rootWorkspaceId === workspace.id` (with no contribution id,
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
  workspace: RootWorkspace,
  dashboardIndex: Map<string, Map<string, Workspace[]>>,
): Promise<void> {
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
  // Single pass over workspaces builds an index keyed by
  // (parentId → contribId → matching workspaces). Without it, each
  // workspace × autoProvision-contribution iteration would scan the full
  // workspaces list (W*C cold-start cost). The index is mutated
  // in lock-step with closeWorkspaceById below so the dedupe pass
  // and the post-dedupe `existingContribIds` snapshot stay in sync.
  const dashboardIndex = new Map<string, Map<string, Workspace[]>>();
  for (const w of get(workspaces)) {
    if (w.isDashboard !== true) continue;
    const parentId = w.rootWorkspaceId;
    if (typeof parentId !== "string") continue;
    const contribId = w.dashboardContributionId;
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
 * Rebuild each Workspace's `branchedWorkspaceIds` list from runtime
 * Workspaces tagged with `rootWorkspaceId`. Called on app startup once
 * workspaces are loaded and workspaces are restored — restoration
 * creates fresh workspace ids so the membership list is recomputed
 * here from the canonical `rootWorkspaceId` tag.
 */
export function reclaimBranchedWorkspaces(): void {
  const primaryWorkspaces = getWorkspaces();
  const workspaceIds = new Set(primaryWorkspaces.map((w) => w.id));

  // Collect workspace ids per workspace in a single pass to avoid one
  // setWorkspaces() call (and event emission) per workspace.
  const newMembers = new Map<string, string[]>();
  for (const ws of get(workspaces)) {
    const rootWorkspaceId = ws.rootWorkspaceId;
    if (
      typeof rootWorkspaceId !== "string" ||
      !workspaceIds.has(rootWorkspaceId)
    )
      continue;
    const members = newMembers.get(rootWorkspaceId) ?? [];
    members.push(ws.id);
    newMembers.set(rootWorkspaceId, members);
  }

  if (newMembers.size > 0) {
    const next = primaryWorkspaces.map((w) => {
      const toAdd = newMembers.get(w.id) ?? [];
      if (toAdd.length === 0) return w;
      const current = w.branchedWorkspaceIds ?? [];
      const existing = new Set(current);
      const fresh = toAdd.filter((id) => !existing.has(id));
      return fresh.length > 0
        ? { ...w, branchedWorkspaceIds: [...current, ...fresh] }
        : w;
    });
    setWorkspaces(next);
    emitStateChanged({});
    schedulePersist();
  }
}

/**
 * Promote every standalone runtime Workspace to a Root by creating a
 * matching RootWorkspace with the same id (the Root runtime workspace
 * and its RootWorkspace entry share an id). A "standalone" runtime
 * workspace is one that:
 *   - has no matching RootWorkspace (no row in the sidebar yet)
 *   - is not a Branch (`rootWorkspaceId` unset). Branches are Branches
 *     for life — even orphan Branches (rootWorkspaceId points at a
 *     missing Workspace) are never promoted to Roots
 *   - is not a Dashboard surface (those belong to a root Workspace)
 *   - is not worktree-backed (worktreePath stamps it as a worktree
 *     Branch even if its rootWorkspaceId is missing)
 */
function materializeStandaloneRoots(): void {
  const knownWorkspaceIds = new Set(getWorkspaces().map((w) => w.id));
  const snapshot = get(workspaces);
  const usedColors = getWorkspaces().map((w) => w.color);

  for (const ws of snapshot) {
    if (knownWorkspaceIds.has(ws.id)) continue;
    // A Branch never becomes a Root. The presence of `rootWorkspaceId`
    // marks the workspace as a Branch for life — orphan or not.
    if (typeof ws.rootWorkspaceId === "string") continue;
    if (ws.isDashboard) continue;
    if ((ws as { worktreePath?: string }).worktreePath) continue;

    const colorIdx = usedColors.length % WORKSPACE_COLOR_SLOTS.length;
    const color: string =
      WORKSPACE_COLOR_SLOTS[colorIdx] ?? WORKSPACE_COLOR_SLOTS[0];
    usedColors.push(color);

    const path = ws.path && ws.path.length > 0 ? ws.path : "~";

    const workspace: RootWorkspace = {
      id: ws.id,
      name: ws.name,
      path,
      color,
      branchedWorkspaceIds: [],
      isGit: false,
      createdAt: new Date().toISOString(),
    };
    addWorkspace(workspace);
    knownWorkspaceIds.add(ws.id);
  }
}

/**
 * Startup reconciliation — called after workspaces are restored.
 * Promotes every standalone runtime Workspace to a Root by creating a
 * matching RootWorkspace (shared id). Branch status is derived
 * directly from `Workspace.rootWorkspaceId`, so no parallel membership
 * registry needs rehydrating at startup.
 *
 * Idempotent.
 */
export async function reconcilePrimaryWorkspaces(): Promise<void> {
  materializeStandaloneRoots();
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

export { getWorkspace, getWorkspaces, setActiveWorkspaceId };
