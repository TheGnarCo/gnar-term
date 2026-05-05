/**
 * Workspace stores — single source of truth for all workspace shapes.
 *
 * Two coexisting store sections:
 *   1. Unified runtime store (`workspaces`, `activeWorkspaceIdx`, ...) —
 *      holds Workspace instances with panes (Branches, Dashboards,
 *      orphaned Branches). All workspaces here share the `Workspace`
 *      type from `types.ts`.
 *   2. Project-record store (`workspacesStore`, `getWorkspaces`,
 *      `setWorkspaces`, ...) — holds `WorkspaceRecord` entries: the
 *      project-bound paneless containers that own project-level fields
 *      (path, color, git) and track which Branches belong to them.
 *      Persisted as entries inside `state.workspaces[]` (alongside
 *      Branches and Dashboards) but kept as a separate runtime store
 *      because they are structurally paneless and are filtered out of
 *      tab-strip / reconciliation iterations.
 *
 * Persistence: a single writer in `workspace-runtime-service.persistWorkspaces`
 * serializes both sides into `state.workspaces[]` on every scheduled flush.
 */
import { get, writable, derived } from "svelte/store";
import type { Writable, Readable } from "svelte/store";
import type { Workspace } from "../types";
import { getAllPanes } from "../types";
import {
  loadState,
  saveState,
  type WorkspaceDef,
  type LayoutNode,
} from "../config";
import { loadExtensionState } from "../services/extension-state";

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
 * path can hydrate PTY surfaces. All non-structural fields (project,
 * dashboard, worktree, locked, extension data) are packed into metadata,
 * which `createWorkspaceFromDef` carries through onto the constructed
 * `Workspace`. Consumers read those fields via `wsMeta(ws)` (see
 * `service-helpers.ts`), which transparently handles both the
 * top-level and metadata shapes.
 */
export function workspaceDefToTemplate(
  def: WorkspaceDef,
): import("../config").WorkspaceTemplate {
  const metadata: Record<string, unknown> = { ...(def.extensionData ?? {}) };
  // Structural / discriminant fields
  if (def.parentWorkspaceId !== undefined)
    metadata.parentWorkspaceId = def.parentWorkspaceId;
  if (def.isDashboard !== undefined) metadata.isDashboard = def.isDashboard;
  if (def.dashboardContributionId !== undefined)
    metadata.dashboardContributionId = def.dashboardContributionId;
  if (def.worktreePath !== undefined) metadata.worktreePath = def.worktreePath;
  if (def.branch !== undefined) metadata.branch = def.branch;
  if (def.baseBranch !== undefined) metadata.baseBranch = def.baseBranch;
  if (def.repoPath !== undefined) metadata.repoPath = def.repoPath;
  if (def.locked !== undefined) metadata.locked = def.locked;
  // Project-level fields — stashed in metadata so `wsMeta(ws)` consumers
  // can read them off the constructed Workspace at runtime.
  if (def.path !== undefined) metadata.path = def.path;
  if (def.color !== undefined) metadata.color = def.color;
  if (def.isGit !== undefined) metadata.isGit = def.isGit;
  if (def.createdAt !== undefined) metadata.createdAt = def.createdAt;
  if (def.autoRunRestoreCommands !== undefined)
    metadata.autoRunRestoreCommands = def.autoRunRestoreCommands;
  if (def.lastActiveBranchedWorkspaceId !== undefined)
    metadata.lastActiveBranchedWorkspaceId = def.lastActiveBranchedWorkspaceId;
  if (def.dashboardWorkspaceId !== undefined)
    metadata.dashboardWorkspaceId = def.dashboardWorkspaceId;

  const nwDef: import("../config").WorkspaceTemplate = {
    id: def.id,
    name: def.name,
    layout: def.layout,
  };
  if (def.color !== undefined) nwDef.color = def.color;
  if (Object.keys(metadata).length > 0) {
    nwDef.metadata = metadata as import("../types").WorkspaceMetadata;
  }
  return nwDef;
}

// ---------------------------------------------------------------------------
// Primary exported store: workspaces (writable)
// ---------------------------------------------------------------------------

/**
 * Live list of all workspaces. Writable owned here; populated via
 * `setWorkspaceList` / `seedWorkspaces` (restore path) or mutated
 * directly by `workspace-runtime-service` (runtime CRUD path).
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
  const panes = getAllPanes($ws.splitRoot);
  return panes.find((p) => p.id === $ws.activePaneId) ?? null;
});

export const activeSurface = derived([activePane], ([$pane]) => {
  if (!$pane) return null;
  return $pane.surfaces.find((s) => s.id === $pane.activeSurfaceId) ?? null;
});

// Persistence is owned by `workspace-runtime-service.persistWorkspaces`,
// which serializes this store and merges in legacy project records to
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

/**
 * Seed stores from deserialized workspace defs. Called from restore path
 * after `loadState()`.
 */
export function seedWorkspaces(
  wsList: Workspace[],
  activeId: string | null,
): void {
  _workspaces.set(wsList);
  if (activeId !== null) {
    activeWorkspaceId.set(activeId);
  }
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
  isExtensionSurface,
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
      // Extension surface
      const def: Record<string, unknown> = { type: "extension" };
      if (s.title) def.name = s.title;
      if (s.id === node.pane.activeSurfaceId) def.focus = true;
      if (isExtensionSurface(s)) {
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
    layout: serializeLayout(ws.splitRoot),
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
  if (ws.parentWorkspaceId !== undefined)
    def.parentWorkspaceId = ws.parentWorkspaceId;
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
// Project-record store (formerly src/lib/stores/workspaces.ts)
//
// Project Workspaces are the project-bound paneless containers that own
// project-level fields (path, color, git) and track which Branches
// (worktree-backed variants) currently belong to them. Persisted inside
// the unified `state.workspaces[]` array alongside Branches/Dashboards.
//
// Pre-Stage-8 fallback: when state.json has no project records yet
// (very old install that skipped Stage 8), data is migrated forward
// from the legacy per-extension file at
// `~/.config/gnar-term/extensions/workspace-groups/state.json`.
// ===========================================================================

// Persist scheduler is injected post-init by workspace-runtime-service to
// avoid a circular module init. Unset until the runtime module finishes
// evaluating — during early tests/bootstrap before the runtime module
// loads, mutations here are no-ops with respect to scheduling.
let _projectSchedulePersist: (() => void) | null = null;
export function installSchedulePersist(fn: () => void): void {
  _projectSchedulePersist = fn;
}

const LEGACY_STATE_ID = "workspace-groups";
const LEGACY_WORKSPACES_KEY = "workspaces";
const LEGACY_ACTIVE_WORKSPACE_ID_KEY = "activeWorkspaceId";

/**
 * WorkspaceRecord — the persisted project-Workspace shape: the
 * project-bound container that owns project-level fields (path, color,
 * git) and tracks which Branches (worktree-backed variants provided by
 * the Branch Workspace extension) currently belong to it. Conceptually
 * this IS a Workspace; the type retains its old name until the runtime
 * unification renames it. New APIs and comments should say "Workspace"
 * and "Branch" rather than "parent" / "child".
 */
export interface WorkspaceRecord {
  id: string;
  name: string;
  /** Root CWD — auto-adoption uses this as a longest-prefix ancestor match. */
  path: string;
  color: string;
  /** Ids of Branches (worktree-backed variants) currently claimed by this Workspace. */
  branchedWorkspaceIds: string[];
  primaryBranchedWorkspaceId?: string;
  lastActiveBranchedWorkspaceId?: string;
  autoRunRestoreCommands?: boolean;
  isGit: boolean;
  createdAt: string;
  dashboardWorkspaceId?: string;
  locked?: boolean;
  pathMissing?: boolean;
}

const _projectWorkspaces = writable<WorkspaceRecord[]>([]);
export const workspacesStore: Readable<WorkspaceRecord[]> = _projectWorkspaces;

const _activeProjectWorkspaceId = writable<string | null>(null);

let _projectWorkspacesLoaded = false;

/**
 * Identify project-Workspace records inside the unified
 * `state.workspaces[]` array. Project records carry a `path` and have
 * neither a `parentWorkspaceId` (Branches/Dashboards) nor a
 * `worktreePath` (orphaned Branches). The post-migration state.json
 * uses this exact shape for project records.
 */
export function isProjectRecord(def: WorkspaceDef): boolean {
  return (
    def.path !== undefined &&
    def.parentWorkspaceId === undefined &&
    def.worktreePath === undefined &&
    def.isDashboard !== true
  );
}

/**
 * Lift a project `WorkspaceDef` (post-migration shape) back to a
 * `WorkspaceRecord` for the in-memory project store. The
 * `branchedWorkspaceIds` cache is reset to `[]` — the
 * `workspace:created` listener rebuilds membership from
 * `metadata.parentWorkspaceId`.
 */
function defToProjectRecord(def: WorkspaceDef): WorkspaceRecord {
  return {
    id: def.id,
    name: def.name,
    path: def.path ?? "",
    color: def.color ?? "",
    isGit: def.isGit ?? false,
    createdAt: def.createdAt ?? new Date().toISOString(),
    branchedWorkspaceIds: [],
    ...(def.autoRunRestoreCommands !== undefined && {
      autoRunRestoreCommands: def.autoRunRestoreCommands,
    }),
    ...(def.lastActiveBranchedWorkspaceId !== undefined && {
      lastActiveBranchedWorkspaceId: def.lastActiveBranchedWorkspaceId,
    }),
    ...(def.dashboardWorkspaceId !== undefined && {
      dashboardWorkspaceId: def.dashboardWorkspaceId,
    }),
    ...(def.locked !== undefined && { locked: def.locked }),
  };
}

/**
 * Inverse of `defToProjectRecord`: serialize a WorkspaceRecord back
 * into a WorkspaceDef for persistence. Used by the unified persist path
 * so all workspaces (project, branched, dashboard) land in
 * `state.workspaces[]` together.
 *
 * The on-disk shape carries an empty layout (`{ pane: { surfaces: [] }
 * }`) for project records — at runtime, project records don't have a
 * splitRoot of their own (their UI is delegated to the active Branch).
 * Layout is preserved across restarts because the migration helper
 * (`migrateLegacyWorkspaces`) inherits the absorbed primary's layout
 * onto the merged record; this function never overwrites it because at
 * runtime the project store does not track layouts.
 */
export function parentWorkspaceToDef(p: WorkspaceRecord): WorkspaceDef {
  const def: WorkspaceDef = {
    id: p.id,
    name: p.name,
    layout: { pane: { surfaces: [] } },
    path: p.path,
    color: p.color,
    isGit: p.isGit,
    createdAt: p.createdAt,
  };
  if (p.autoRunRestoreCommands !== undefined) {
    def.autoRunRestoreCommands = p.autoRunRestoreCommands;
  }
  if (p.lastActiveBranchedWorkspaceId !== undefined) {
    def.lastActiveBranchedWorkspaceId = p.lastActiveBranchedWorkspaceId;
  }
  if (p.dashboardWorkspaceId !== undefined) {
    def.dashboardWorkspaceId = p.dashboardWorkspaceId;
  }
  if (p.locked !== undefined) def.locked = p.locked;
  return def;
}

/** Snapshot of project records ready to merge into `state.workspaces[]`. */
export function getProjectRecordsAsWorkspaceDefs(): WorkspaceDef[] {
  return get(_projectWorkspaces).map(parentWorkspaceToDef);
}

function scheduleProjectPersist(): void {
  _projectSchedulePersist?.();
}

/**
 * Read state from disk and seed the project-record stores. Idempotent —
 * subsequent calls are no-ops so tests can freely call the initializer.
 *
 * `loadState` runs `migrateLegacyWorkspaces` first, so by the time we
 * reach this code project records always live inside
 * `state.workspaces[]` — we project them back to `WorkspaceRecord`
 * shape for the in-memory store. The pre-Stage-8 extension-state
 * file is consulted only when `state.workspaces[]` has no project
 * records yet, and any data found there is persisted forward into
 * `state.workspaces[]` so future loads bypass the fallback.
 */
export async function loadWorkspaces(): Promise<void> {
  if (_projectWorkspacesLoaded) return;
  _projectWorkspacesLoaded = true;

  const state = await loadState();

  let records: WorkspaceRecord[] | null = null;
  let active: string | null = null;

  // Post-migration path: project records live in state.workspaces[].
  if (Array.isArray(state.workspaces)) {
    const projectDefs = state.workspaces.filter(isProjectRecord);
    if (projectDefs.length > 0) {
      records = projectDefs.map(defToProjectRecord);
    }
  }

  // Pre-Stage-8 fallback: legacy per-extension state file.
  if (records === null) {
    const legacy = await loadExtensionState(LEGACY_STATE_ID);
    if (Array.isArray(legacy[LEGACY_WORKSPACES_KEY])) {
      records = legacy[LEGACY_WORKSPACES_KEY] as WorkspaceRecord[];
    }
    if (typeof legacy[LEGACY_ACTIVE_WORKSPACE_ID_KEY] === "string") {
      active = legacy[LEGACY_ACTIVE_WORKSPACE_ID_KEY] as string;
    }
    if (records && records.length > 0) {
      // Persist forward immediately so future loads read from AppState.
      await saveState({
        workspaces: [
          ...records.map(parentWorkspaceToDef),
          ...(state.workspaces ?? []),
        ],
        activeWorkspaceId: active ?? state.activeWorkspaceId,
      });
    }
  }

  // Active id resolution: state.activeWorkspaceId always reflects the
  // post-migration id (migration redirects absorbed primary ids to project ids).
  if (
    active === null &&
    typeof state.activeWorkspaceId === "string" &&
    records?.some((w) => w.id === state.activeWorkspaceId)
  ) {
    active = state.activeWorkspaceId;
  }

  _projectWorkspaces.set((records ?? []).map(normalizePersistedRecord));
  _activeProjectWorkspaceId.set(active);
}

export function getWorkspaces(): WorkspaceRecord[] {
  return get(_projectWorkspaces);
}

export function getWorkspace(id: string): WorkspaceRecord | undefined {
  return getWorkspaces().find((w) => w.id === id);
}

export function setWorkspaces(next: WorkspaceRecord[]): void {
  _projectWorkspaces.set(next);
  scheduleProjectPersist();
}

export function getActiveWorkspaceId(): string | null {
  return get(_activeProjectWorkspaceId);
}

export function setActiveWorkspaceId(id: string | null): void {
  _activeProjectWorkspaceId.set(id);
  scheduleProjectPersist();
}

/** Test hook — reset in-memory state so tests start clean. */
export function resetWorkspacesForTest(): void {
  _projectWorkspaces.set([]);
  _activeProjectWorkspaceId.set(null);
  _projectWorkspacesLoaded = false;
}

/**
 * Normalize a workspace loaded from disk: reset the runtime-only
 * `branchedWorkspaceIds: []` cache so the `workspace:created` listener
 * rebuilds membership from `metadata.parentWorkspaceId`.
 */
function normalizePersistedRecord(raw: unknown): WorkspaceRecord {
  const g = raw as Record<string, unknown>;
  const { branchedWorkspaceIds: _drop, ...rest } = g;
  return {
    ...(rest as Omit<WorkspaceRecord, "branchedWorkspaceIds">),
    branchedWorkspaceIds: [],
  } as WorkspaceRecord;
}
