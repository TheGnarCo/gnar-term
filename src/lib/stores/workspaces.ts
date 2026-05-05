/**
 * Workspaces store — core's reactive source of truth for the persisted
 * Workspace list (the project-bound things that show in the sidebar).
 * Previously owned by the project-scope extension; relocated to core in
 * Stage 5 so commands, overlays, and row renderers that manipulate
 * workspaces no longer depend on the extension API layer.
 *
 * Persistence (Stage 9): project Workspace records are persisted as
 * entries inside the unified `AppState.workspaces[]` (alongside Branches
 * and Dashboards). The legacy on-disk keys
 * `parentWorkspaces` / `activeParentWorkspaceId` are migrated forward
 * once at load time (`loadState`) and then dropped. This store still
 * exposes the legacy `ParentWorkspace` shape to existing consumers — its
 * data is projected from `state.workspaces[]` at load and serialized
 * back through `getProjectRecordsAsWorkspaceDefs()` on every persist
 * triggered by the unified workspace store.
 *
 * On first load after the Stage 8 upgrade (no `parentWorkspaces` in
 * state.json yet, no project records in `state.workspaces[]`), data is
 * still migrated forward from the legacy per-extension file at
 * `~/.config/gnar-term/extensions/workspace-groups/state.json`.
 */
import { get, writable, type Readable } from "svelte/store";
import { loadExtensionState } from "../services/extension-state";
import { loadState, saveState, type WorkspaceDef } from "../config";

// Persist scheduler is injected post-init by workspace-runtime-service to
// avoid a circular module init (this store is imported from runtime-service
// for `getWorkspace`). Unset until the runtime module finishes evaluating —
// during early tests/bootstrap before the runtime module loads, mutations
// here are no-ops with respect to scheduling, which matches prior behavior.
let _scheduledPersist: (() => void) | null = null;
export function installSchedulePersist(fn: () => void): void {
  _scheduledPersist = fn;
}

const LEGACY_STATE_ID = "workspace-groups";
const LEGACY_WORKSPACES_KEY = "workspaces";
const LEGACY_ACTIVE_WORKSPACE_ID_KEY = "activeWorkspaceId";

/**
 * ParentWorkspace — legacy name for the persisted Workspace record:
 * the project-bound container that owns project-level fields (path,
 * color, git) and tracks which Branches (worktree-backed variants
 * provided by the Branch Workspace extension) currently belong to it.
 * Conceptually this IS a Workspace; the type retains its old name
 * until the runtime unification renames it. New APIs and comments
 * should say "Workspace" and "Branch" rather than "parent" / "child".
 */
export interface ParentWorkspace {
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

const _workspaces = writable<ParentWorkspace[]>([]);
export const workspacesStore: Readable<ParentWorkspace[]> = _workspaces;

const _activeWorkspaceId = writable<string | null>(null);

let _loaded = false;

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
 * `ParentWorkspace` for the legacy in-memory store. The
 * `branchedWorkspaceIds` cache is reset to `[]` — the
 * `workspace:created` listener rebuilds membership from
 * `metadata.parentWorkspaceId`.
 */
function defToParentWorkspace(def: WorkspaceDef): ParentWorkspace {
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
 * Inverse of `defToParentWorkspace`: serialize a ParentWorkspace back
 * into a WorkspaceDef for persistence. Used by the unified workspace
 * store's persist path so all workspaces (project, branched, dashboard)
 * land in `state.workspaces[]` together.
 *
 * The on-disk shape carries an empty layout (`{ pane: { surfaces: [] }
 * }`) for project records — at runtime, project records don't have a
 * splitRoot of their own (their UI is delegated to the active Branch).
 * Layout is preserved across restarts because the migration helper
 * (`migrateLegacyWorkspaces`) inherits the absorbed primary's layout
 * onto the merged record; this function never overwrites it because at
 * runtime the legacy store does not track layouts.
 */
export function parentWorkspaceToDef(p: ParentWorkspace): WorkspaceDef {
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
  return get(_workspaces).map(parentWorkspaceToDef);
}

function schedulePersist(): void {
  _scheduledPersist?.();
}

/**
 * Read state from disk and seed the stores. Idempotent — subsequent
 * calls are no-ops so tests can freely call the initializer.
 *
 * Stage 9: project records live inside `state.workspaces[]` after
 * migration runs in `loadState`. We project them back to
 * `ParentWorkspace` shape for the legacy in-memory store.
 *
 * On first launch where neither `state.parentWorkspaces` nor any
 * project record in `state.workspaces[]` is present (very old install),
 * fall back to the legacy per-extension state file and persist forward.
 */
export async function loadWorkspaces(): Promise<void> {
  if (_loaded) return;
  _loaded = true;

  const state = await loadState();

  let workspaces: ParentWorkspace[] | null = null;
  let active: string | null = null;

  // Post-migration path: project records live in state.workspaces[].
  if (Array.isArray(state.workspaces)) {
    const projectDefs = state.workspaces.filter(isProjectRecord);
    if (projectDefs.length > 0) {
      workspaces = projectDefs.map(defToParentWorkspace);
    }
  }

  // Pre-migration paths (should be rare since loadState runs migration):
  // 1. state.parentWorkspaces still present (state.json predates this load).
  if (workspaces === null && Array.isArray(state.parentWorkspaces)) {
    workspaces = state.parentWorkspaces;
  }

  // 2. legacy extension state file.
  if (workspaces === null) {
    const legacy = await loadExtensionState(LEGACY_STATE_ID);
    if (Array.isArray(legacy[LEGACY_WORKSPACES_KEY])) {
      workspaces = legacy[LEGACY_WORKSPACES_KEY] as ParentWorkspace[];
    }
    if (typeof legacy[LEGACY_ACTIVE_WORKSPACE_ID_KEY] === "string") {
      active = legacy[LEGACY_ACTIVE_WORKSPACE_ID_KEY] as string;
    }
    if (workspaces && workspaces.length > 0) {
      // Persist forward immediately so future loads read from AppState.
      await saveState({
        workspaces: [
          ...workspaces.map(parentWorkspaceToDef),
          ...(state.workspaces ?? []),
        ],
        activeWorkspaceId: active ?? state.activeWorkspaceId,
      });
    }
  }

  // Active id resolution:
  //   - state.activeWorkspaceId may already point at the project after migration.
  //   - state.activeParentWorkspaceId is dropped by migration but tolerated as fallback.
  if (active === null) {
    const candidate =
      typeof state.activeWorkspaceId === "string"
        ? state.activeWorkspaceId
        : typeof state.activeParentWorkspaceId === "string"
          ? state.activeParentWorkspaceId
          : null;
    if (candidate !== null && workspaces?.some((w) => w.id === candidate)) {
      active = candidate;
    }
  }

  _workspaces.set((workspaces ?? []).map(normalizePersistedWorkspace));
  _activeWorkspaceId.set(active);
}

/** Flush pending writes — called from app close hooks. */
export async function flushWorkspaces(): Promise<void> {
  // Persistence is owned by the unified workspace store; that store's
  // own flush hook handles the write. No-op here.
}

export function getWorkspaces(): ParentWorkspace[] {
  return get(_workspaces);
}

export function getWorkspace(id: string): ParentWorkspace | undefined {
  return getWorkspaces().find((w) => w.id === id);
}

export function setWorkspaces(next: ParentWorkspace[]): void {
  _workspaces.set(next);
  schedulePersist();
}

export function getActiveWorkspaceId(): string | null {
  return get(_activeWorkspaceId);
}

export function setActiveWorkspaceId(id: string | null): void {
  _activeWorkspaceId.set(id);
  schedulePersist();
}

/** Test hook — reset in-memory state so tests start clean. */
export function resetWorkspacesForTest(): void {
  _workspaces.set([]);
  _activeWorkspaceId.set(null);
  _loaded = false;
}

/**
 * Normalize a workspace loaded from disk: reset the runtime-only
 * `branchedWorkspaceIds: []` cache so the `workspace:created` listener
 * rebuilds membership from `metadata.parentWorkspaceId`.
 */
function normalizePersistedWorkspace(raw: unknown): ParentWorkspace {
  const g = raw as Record<string, unknown>;
  const { branchedWorkspaceIds: _drop, ...rest } = g;
  return {
    ...(rest as Omit<ParentWorkspace, "branchedWorkspaceIds">),
    branchedWorkspaceIds: [],
  } as ParentWorkspace;
}
