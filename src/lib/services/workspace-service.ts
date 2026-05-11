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
import type { RootWorkspace } from "../stores/workspace";
import { WORKSPACE_COLOR_SLOTS } from "../../extensions/api";
import { appendRootRow, removeRootRow } from "../stores/root-row-order";
import { workspaces } from "../stores/workspace";
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
import { getDashboardContributions } from "./dashboard-contribution-registry";
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

/**
 * Provision every registered auto-provisioning dashboard contribution
 * for `workspace`. Routes through `openAsTab` with `{ activate: false }`:
 * each dashboard becomes a tab in the workspace's active pane
 * (deduplicated by the surface registry's matchProps).
 *
 *   - `autoProvision` contributions (settings) — always opened.
 *   - `defaultEnabled` contributions (diff, agentic) — opened unless
 *     the workspace's `dismissedDashboardContributionIds` lists them,
 *     so a user-removed default-on dashboard does not come back.
 *
 * Idempotent — `openAsTab` is a no-op when a matching tab already exists.
 */
export async function provisionAutoDashboardsForWorkspace(
  workspace: RootWorkspace,
): Promise<void> {
  const dismissed = new Set(workspace.dismissedDashboardContributionIds ?? []);
  for (const c of getDashboardContributions()) {
    if (!c.autoProvision && !c.defaultEnabled) continue;
    if (!c.autoProvision && dismissed.has(c.id)) continue;
    try {
      await c.openAsTab(workspace, { activate: false });
    } catch (err) {
      console.warn(
        `[workspace-service] auto-provision failed for "${c.id}":`,
        err,
      );
    }
  }
}

/**
 * True when `contributionId` is enabled for `workspace` per the persisted
 * Settings state — independent of whether a tab is currently open. Drives
 * sidebar chip presence: closing a dashboard tab does NOT remove its chip,
 * so the chip must derive from this enabled state, not from live tab presence.
 *
 * Enabled when:
 *   - `autoProvision` contributions — always (lock-on)
 *   - `defaultEnabled` contributions — unless dismissed via Settings
 *   - opt-in contributions — only when present in `enabledDashboardContributionIds`
 *
 * Returns false when the contribution isn't registered.
 */
export function isDashboardContributionEnabled(
  workspace: RootWorkspace,
  contributionId: string,
): boolean {
  const contribution = getDashboardContributions().find(
    (c) => c.id === contributionId,
  );
  if (!contribution) return false;
  if (contribution.autoProvision) return true;
  if (contribution.defaultEnabled) {
    const dismissed = workspace.dismissedDashboardContributionIds ?? [];
    return !dismissed.includes(contributionId);
  }
  const enabled = workspace.enabledDashboardContributionIds ?? [];
  return enabled.includes(contributionId);
}

/**
 * Add `contributionId` to the workspace's `enabledDashboardContributionIds`
 * so its sidebar chip appears. Used for opt-in contributions toggled on
 * from Workspace Settings. Idempotent — duplicates are coalesced. No-op
 * when the workspace has no matching root entry.
 */
export function recordDashboardEnable(
  rootWorkspaceId: string,
  contributionId: string,
): void {
  const ws = getWorkspace(rootWorkspaceId);
  if (!ws) return;
  const current = ws.enabledDashboardContributionIds ?? [];
  if (current.includes(contributionId)) return;
  updateWorkspace(rootWorkspaceId, {
    enabledDashboardContributionIds: [...current, contributionId],
  });
}

/**
 * Remove `contributionId` from the workspace's
 * `enabledDashboardContributionIds`. Called when the user toggles off an
 * opt-in contribution from Workspace Settings. No-op when the id isn't
 * present.
 */
export function clearDashboardEnable(
  rootWorkspaceId: string,
  contributionId: string,
): void {
  const ws = getWorkspace(rootWorkspaceId);
  if (!ws) return;
  const current = ws.enabledDashboardContributionIds ?? [];
  if (!current.includes(contributionId)) return;
  const next = current.filter((id) => id !== contributionId);
  updateWorkspace(rootWorkspaceId, {
    enabledDashboardContributionIds: next.length > 0 ? next : undefined,
  });
}

/**
 * Append `contributionId` to the workspace's
 * `dismissedDashboardContributionIds` so future provisioning passes do
 * not re-open the dashboard tab. Idempotent — duplicates are coalesced.
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
 * contribution from Workspace Settings. No-op when the id isn't present.
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
 * — not persisted — and is re-derived on every sweep. Sidebar
 * components surface a "path missing" affordance when the flag is set.
 *
 * On each pass:
 * - When the path exists, record its inode in `pathInode` (persisted)
 *   so a future rename can be detected.
 * - When the path does NOT exist but a `pathInode` is known, scan the
 *   parent directory for a sibling with the same inode. If found, the
 *   directory was renamed within its parent — update `path` to the new
 *   location and clear `pathMissing` instead of flagging it.
 *
 * Best-effort: failing FS invokes are treated as "not missing" so a
 * transient error doesn't paint every workspace red. Idempotent.
 */
export async function validateWorkspaceRootPaths(): Promise<void> {
  const workspaces = getWorkspaces();
  for (const workspace of workspaces) {
    if (!workspace.path) continue;
    let exists = true;
    try {
      exists = await invoke<boolean>("file_exists", { path: workspace.path });
    } catch {
      exists = true;
    }
    if (exists) {
      const patch: { pathMissing?: boolean; pathInode?: number } = {};
      if ((workspace.pathMissing ?? false) !== false) patch.pathMissing = false;
      try {
        const inode = await invoke<number>("get_path_inode", {
          path: workspace.path,
        });
        if (workspace.pathInode !== inode) patch.pathInode = inode;
      } catch {
        // Inode unavailable (Windows / unsupported FS). Skip cache
        // refresh — rename detection just won't fire on this workspace.
      }
      if (Object.keys(patch).length > 0) {
        updateWorkspace(workspace.id, patch);
      }
      continue;
    }

    // Path missing — try inode-based rediscovery before flagging.
    const cachedInode = workspace.pathInode;
    if (typeof cachedInode === "number") {
      const parent = dirname(workspace.path);
      try {
        const found = await invoke<string | null>("find_dir_by_inode", {
          parent,
          inode: cachedInode,
        });
        if (found) {
          updateWorkspace(workspace.id, {
            path: found,
            pathMissing: false,
          });
          continue;
        }
      } catch {
        // Parent unreadable or platform doesn't support inodes. Fall
        // through to flagging the workspace as missing.
      }
    }
    if ((workspace.pathMissing ?? false) !== true) {
      updateWorkspace(workspace.id, { pathMissing: true });
    }
  }
}

/** POSIX-style parent directory. Trailing slashes are stripped. */
function dirname(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0) return "/";
  return trimmed.slice(0, idx);
}

export { getWorkspace, getWorkspaces, setActiveWorkspaceId };
