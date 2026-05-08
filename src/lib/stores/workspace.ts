/**
 * Workspace stores — single source of truth for all workspace shapes.
 *
 * One unified runtime store (`workspaces`, `activeWorkspaceIdx`, ...)
 * holds every Workspace instance: root path-rooted Workspaces, branched
 * (worktree-backed) children, and Dashboards. The "root workspace"
 * filter (`!rootWorkspaceId && !isDashboard && !worktreePath`) selects
 * the entries that own Workspace-level fields (path, color, git) and
 * appear as path-rooted rows in the sidebar.
 *
 * Persistence: a single writer in `workspace-runtime-service.persistWorkspaces`
 * serializes the unified store into `state.workspaces[]` on every scheduled
 * flush.
 */
import { get, writable, derived } from "svelte/store";
import type { Writable, Readable } from "svelte/store";
import type { Workspace } from "../types";
import { getAllPanes } from "../types";
import { loadState, type WorkspaceDef, type LayoutNode } from "../config";

// ---------------------------------------------------------------------------
// Core writables
// ---------------------------------------------------------------------------

/** The live list of all workspaces (primary, branched, dashboards). */
const _workspaces = writable<Workspace[]>([]);

/** Index of the currently active workspace in the `_workspaces` list. */
export const activeWorkspaceIdx: Writable<number> = writable(-1);

/** [previousId, currentId] — updated on each switchWorkspace call. */
export const workspaceHistory = writable<[string | null, string | null]>([
  null,
  null,
]);

/**
 * Id of the currently-active pseudo-workspace (e.g. the Global Agentic
 * Dashboard), or `null` when a real workspace is active. Pseudo-workspaces
 * are registered via `registerPseudoWorkspace` and do not live in the
 * `workspaces` array — they're rendered from the pseudo-workspace
 * registry. Activation is mutually exclusive with `activeWorkspaceIdx`:
 * setting this to a non-null id hides every real workspace view and
 * mounts the pseudo's body instead.
 */
export const activePseudoWorkspaceId = writable<string | null>(null);

/**
 * When non-null, holds the surface ID of the pane that is "zoomed" to fill
 * the full workspace area. All other panes are hidden (but kept mounted) so
 * terminal state is preserved. Cleared on workspace switch.
 */
export const zoomedSurfaceId = writable<string | null>(null);

/**
 * Convert a unified `WorkspaceDef` (on-disk format) into a
 * `WorkspaceTemplate` so the existing `createWorkspaceFromDef` runtime
 * path can hydrate PTY surfaces. All fields are passed through at the
 * top level — extension-owned data lives in `extensionData`.
 */
export function workspaceDefToTemplate(
  def: WorkspaceDef,
): import("../config").WorkspaceTemplate {
  const nwDef: import("../config").WorkspaceTemplate = {
    id: def.id,
    name: def.name,
    layout: def.layout,
  };

  // Workspace-level fields
  if (def.color !== undefined) nwDef.color = def.color;
  if (def.path !== undefined) nwDef.path = def.path;
  if (def.isGit !== undefined) nwDef.isGit = def.isGit;
  if (def.createdAt !== undefined) nwDef.createdAt = def.createdAt;
  if (def.autoRunRestoreCommands !== undefined)
    nwDef.autoRunRestoreCommands = def.autoRunRestoreCommands;
  if (def.lastActiveBranchedWorkspaceId !== undefined)
    nwDef.lastActiveBranchedWorkspaceId = def.lastActiveBranchedWorkspaceId;
  if (def.dashboardWorkspaceId !== undefined)
    nwDef.dashboardWorkspaceId = def.dashboardWorkspaceId;
  if (def.dismissedDashboardContributionIds !== undefined)
    nwDef.dismissedDashboardContributionIds =
      def.dismissedDashboardContributionIds;
  if (def.enabledDashboardContributionIds !== undefined)
    nwDef.enabledDashboardContributionIds = def.enabledDashboardContributionIds;

  // Structural / discriminant fields.
  if (def.rootWorkspaceId !== undefined)
    nwDef.rootWorkspaceId = def.rootWorkspaceId;
  if (def.isDashboard !== undefined) nwDef.isDashboard = def.isDashboard;
  if (def.dashboardContributionId !== undefined)
    nwDef.dashboardContributionId = def.dashboardContributionId;
  if (def.locked !== undefined) nwDef.locked = def.locked;

  // Branch fields
  if (def.worktreePath !== undefined) nwDef.worktreePath = def.worktreePath;
  if (def.branch !== undefined) nwDef.branch = def.branch;
  if (def.baseBranch !== undefined) nwDef.baseBranch = def.baseBranch;
  if (def.repoPath !== undefined) nwDef.repoPath = def.repoPath;

  if (def.extensionData !== undefined) nwDef.extensionData = def.extensionData;
  return nwDef;
}

// ---------------------------------------------------------------------------
// Primary exported store: workspaces (writable)
// ---------------------------------------------------------------------------

/**
 * Live list of all workspaces. Writable owned here; populated and
 * mutated by `workspace-runtime-service` (the canonical CRUD path,
 * shared by both runtime user actions and the restore boot path).
 */
export const workspaces: Writable<Workspace[]> & Readable<Workspace[]> =
  _workspaces;

/**
 * The id of the currently-active workspace.
 *
 * Reads: derived from `activeWorkspaceIdx` + `workspaces` so the value always
 * reflects the activation model. Returns `null` when no workspace is active
 * (idx === -1 or out of bounds).
 *
 * Writes: Setting an id looks up the matching index in the current `workspaces`
 * snapshot and writes the idx; setting `null` writes `-1`. Setting an id that
 * does not resolve to a workspace is a no-op.
 */
const _activeWorkspaceIdReadable: Readable<string | null> = derived(
  [_workspaces, activeWorkspaceIdx],
  ([$ws, $idx]) => {
    if ($idx < 0 || $idx >= $ws.length) return null;
    return $ws[$idx]?.id ?? null;
  },
);

export const activeWorkspaceId = {
  subscribe: _activeWorkspaceIdReadable.subscribe,
  set(id: string | null): void {
    if (id === null) {
      activeWorkspaceIdx.set(-1);
      return;
    }
    const idx = get(_workspaces).findIndex((w) => w.id === id);
    if (idx >= 0) {
      activeWorkspaceIdx.set(idx);
    }
  },
  update(fn: (id: string | null) => string | null): void {
    const current = get(_activeWorkspaceIdReadable);
    const next = fn(current);
    this.set(next);
  },
};

// ---------------------------------------------------------------------------
// Derived stores
// ---------------------------------------------------------------------------

export const activeWorkspace = derived(
  [_workspaces, activeWorkspaceId],
  ([$ws, $id]) => $ws.find((w) => w.id === $id) ?? null,
);

export const activePane = derived([activeWorkspace], ([$ws]) => {
  if (!$ws) return null;
  const panes = getAllPanes($ws.paneLayout);
  return panes.find((p) => p.id === $ws.activePaneId) ?? null;
});

export const activeSurface = derived([activePane], ([$pane]) => {
  if (!$pane) return null;
  return $pane.surfaces.find((s) => s.id === $pane.activeSurfaceId) ?? null;
});

// Persistence is owned by `workspace-runtime-service.persistWorkspaces`,
// which serializes this store and merges in RootWorkspace entries to
// produce the single canonical `state.workspaces[]` writer.

// ---------------------------------------------------------------------------
// Getters
// ---------------------------------------------------------------------------

export function getWorkspaceList(): Workspace[] {
  return get(_workspaces);
}

export function getWorkspaceById(id: string): Workspace | undefined {
  return getWorkspaceList().find((w) => w.id === id);
}

export function getActiveWorkspaceIdValue(): string | null {
  return get(activeWorkspaceId);
}

// ---------------------------------------------------------------------------
// Mutators
// ---------------------------------------------------------------------------

export function setWorkspaceList(next: Workspace[]): void {
  _workspaces.set(next);
}

export function updateWorkspaceInList(
  id: string,
  patch: Partial<Omit<Workspace, "id">>,
): void {
  _workspaces.update((list) =>
    list.map((ws) => (ws.id === id ? { ...ws, ...patch } : ws)),
  );
}

export function setActiveWorkspaceIdValue(id: string | null): void {
  activeWorkspaceId.set(id);
}

/** Test hook — reset in-memory state so tests start clean. */
export function resetWorkspaceStoreForTest(): void {
  _workspaces.set([]);
  activeWorkspaceIdx.set(-1);
}

// ---------------------------------------------------------------------------
// Serialization helpers (layout round-trip)
// ---------------------------------------------------------------------------

import {
  isTerminalSurface,
  isPreviewSurface,
  isRegistrySurface,
  type SplitNode,
} from "../types";

export function serializeLayout(node: SplitNode): LayoutNode {
  if (node.type === "pane") {
    const surfaces = node.pane.surfaces.map((s) => {
      if (isTerminalSurface(s)) {
        const def: Record<string, unknown> = { type: "terminal" };
        if (s.cwd) def.cwd = s.cwd;
        if (s.definedCommand) def.command = s.definedCommand;
        if (s.id === node.pane.activeSurfaceId) def.focus = true;
        return def;
      }
      if (isPreviewSurface(s)) {
        const def: Record<string, unknown> = { type: "preview", path: s.path };
        if (s.title) def.name = s.title;
        if (s.id === node.pane.activeSurfaceId) def.focus = true;
        return def;
      }
      // Registry-backed surface
      const def: Record<string, unknown> = { type: "registry" };
      if (s.title) def.name = s.title;
      if (s.id === node.pane.activeSurfaceId) def.focus = true;
      if (isRegistrySurface(s)) {
        def.extensionType = s.surfaceTypeId;
        if (s.props) {
          const {
            element: _element,
            watchId: _watchId,
            ...serializableProps
          } = s.props as Record<string, unknown>;
          if (Object.keys(serializableProps).length > 0) {
            def.extensionProps = serializableProps;
          }
        }
      }
      return def;
    });
    return { pane: { surfaces } };
  }
  return {
    direction: node.direction,
    split: node.ratio,
    children: [
      serializeLayout(node.children[0]),
      serializeLayout(node.children[1]),
    ],
  };
}

export function serializeWorkspace(ws: Workspace): WorkspaceDef {
  const def: WorkspaceDef = {
    id: ws.id,
    name: ws.name,
    layout: serializeLayout(ws.paneLayout),
  };
  if (ws.path !== undefined) def.path = ws.path;
  if (ws.color !== undefined) def.color = ws.color;
  if (ws.isGit !== undefined) def.isGit = ws.isGit;
  if (ws.createdAt !== undefined) def.createdAt = ws.createdAt;
  if (ws.autoRunRestoreCommands !== undefined)
    def.autoRunRestoreCommands = ws.autoRunRestoreCommands;
  if (ws.lastActiveBranchedWorkspaceId !== undefined)
    def.lastActiveBranchedWorkspaceId = ws.lastActiveBranchedWorkspaceId;
  if (ws.dashboardWorkspaceId !== undefined)
    def.dashboardWorkspaceId = ws.dashboardWorkspaceId;
  if (ws.dismissedDashboardContributionIds !== undefined)
    def.dismissedDashboardContributionIds =
      ws.dismissedDashboardContributionIds;
  if (ws.enabledDashboardContributionIds !== undefined)
    def.enabledDashboardContributionIds = ws.enabledDashboardContributionIds;
  if (ws.rootWorkspaceId !== undefined)
    def.rootWorkspaceId = ws.rootWorkspaceId;
  if (ws.isDashboard !== undefined) def.isDashboard = ws.isDashboard;
  if (ws.dashboardContributionId !== undefined)
    def.dashboardContributionId = ws.dashboardContributionId;
  if ("worktreePath" in ws && ws.worktreePath !== undefined)
    def.worktreePath = ws.worktreePath as string;
  if ("branch" in ws && ws.branch !== undefined)
    def.branch = ws.branch as string;
  if ("baseBranch" in ws && ws.baseBranch !== undefined)
    def.baseBranch = ws.baseBranch as string;
  if ("repoPath" in ws && ws.repoPath !== undefined)
    def.repoPath = ws.repoPath as string;
  if (ws.locked !== undefined) def.locked = ws.locked;
  if (ws.extensionData !== undefined) def.extensionData = ws.extensionData;
  return def;
}

// ===========================================================================
// Root-workspace surface
//
// "Root workspaces" are the path-rooted entries inside `_workspaces` —
// `Workspace` rows that own Workspace-level fields (path, color, git)
// and track which Branches (worktree-backed variants) belong to them.
// They live in the same array as Branches and Dashboards; the helpers
// below project that array through the root filter.
// ===========================================================================

/**
 * `RootWorkspace` narrows `Workspace` to the fields a root workspace
 * is guaranteed to own at runtime (path, color, branchedWorkspaceIds,
 * isGit, createdAt). Structural fields (`paneLayout`, `activePaneId`)
 * stay optional so the creation flow can construct an entry before its
 * tab surface exists; `addWorkspace` mints a placeholder paneLayout at
 * write time, and `createWorkspaceFromDef` overwrites it once the
 * runtime workspace materializes.
 *
 * This is a typed view over `Workspace` rows in the unified
 * `_workspaces` store — there is no separate root-only store.
 */
export type RootWorkspace = Omit<Workspace, "paneLayout" | "activePaneId"> & {
  path: string;
  color: string;
  branchedWorkspaceIds: string[];
  isGit: boolean;
  createdAt: string;
  paneLayout?: Workspace["paneLayout"];
  activePaneId?: Workspace["activePaneId"];
};

/** A `Workspace` is a "root workspace" iff it owns Workspace-level fields. */
function isRootWorkspace(ws: Workspace): boolean {
  if (ws.rootWorkspaceId !== undefined) return false;
  if (ws.isDashboard === true) return false;
  if (typeof (ws as { worktreePath?: string }).worktreePath === "string") {
    return false;
  }
  return true;
}

/**
 * Sidebar's "selected Workspace" pointer — independent from the focused
 * tab tracked by `activeWorkspaceIdx`.
 *
 * The persisted `state.activeWorkspaceId` prefers this pointer over the
 * runtime tab id, so that on restart the sidebar restores the Workspace
 * the user was last interacting with at the row level even if the
 * focused tab belonged to one of its Branches. Set by
 * `setActiveWorkspaceId()` and read by `workspace-persist.ts`.
 */
const _activeRootWorkspaceId = writable<string | null>(null);

/**
 * Public root-workspaces store. Read-only projection of `_workspaces`
 * filtered to the path-rooted entries. Writes go through the typed
 * helpers (`addWorkspace`, `setWorkspaces`, ...) which preserve
 * children/dashboards by editing the array in place.
 */
export const workspacesStore: Readable<RootWorkspace[]> = derived(
  _workspaces,
  ($ws) => $ws.filter(isRootWorkspace) as RootWorkspace[],
);

let _rootWorkspacesLoaded = false;

/**
 * Read state from disk and seed the active root-workspace id. The
 * unified `_workspaces` store itself is hydrated by the runtime path
 * (`restoreWorkspaces` → `createWorkspaceFromDef`); this function only
 * handles the active-id pointer and the one-shot loaded flag.
 *
 * Idempotent — subsequent calls are no-ops so tests can freely call
 * the initializer.
 */
export async function loadWorkspaces(): Promise<void> {
  if (_rootWorkspacesLoaded) return;
  _rootWorkspacesLoaded = true;

  const state = await loadState();
  if (typeof state.activeWorkspaceId === "string") {
    _activeRootWorkspaceId.set(state.activeWorkspaceId);
  }
}

export function getWorkspaces(): RootWorkspace[] {
  return get(_workspaces).filter(isRootWorkspace) as RootWorkspace[];
}

export function getWorkspace(id: string): RootWorkspace | undefined {
  return getWorkspaces().find((w) => w.id === id);
}

/**
 * Replace the root-workspace slice of the unified store with `next`,
 * preserving every non-root entry (children + dashboards) in place.
 * Roots in `next` keep the order in which they appear; non-root entries
 * keep their original order, with non-root entries that originally
 * appeared before any root retained at the front.
 */
export function setWorkspaces(next: readonly RootWorkspace[]): void {
  _workspaces.update((current) => {
    const merged: Workspace[] = [];
    let nextIdx = 0;
    for (const ws of current) {
      if (isRootWorkspace(ws)) {
        if (nextIdx < next.length) {
          merged.push(next[nextIdx]! as Workspace);
          nextIdx++;
        }
      } else {
        merged.push(ws);
      }
    }
    while (nextIdx < next.length) {
      merged.push(next[nextIdx]! as Workspace);
      nextIdx++;
    }
    return merged;
  });
}

export function getActiveWorkspaceId(): string | null {
  return get(_activeRootWorkspaceId);
}

export function setActiveWorkspaceId(id: string | null): void {
  _activeRootWorkspaceId.set(id);
}

/** Test hook — reset in-memory state so tests start clean. */
export function resetWorkspacesForTest(): void {
  _workspaces.set([]);
  _activeRootWorkspaceId.set(null);
  _rootWorkspacesLoaded = false;
}
