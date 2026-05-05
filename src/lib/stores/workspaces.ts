/**
 * Workspaces store — core's reactive source of truth for the persisted
 * parent workspace list. Previously owned by the project-scope extension;
 * relocated to core in Stage 5 so commands, overlays, and row renderers
 * that manipulate workspaces no longer depend on the extension API
 * layer.
 *
 * Persistence (Stage 8): parent workspaces and the active-parent id live
 * inside the unified `AppState` (`~/.config/gnar-term/state.json`) under
 * `parentWorkspaces` / `activeParentWorkspaceId`, alongside the unified
 * Workspace store. On first load after upgrade, data is migrated forward
 * from the legacy per-extension file at
 * `~/.config/gnar-term/extensions/workspace-groups/state.json`; the
 * legacy file is left in place for now so a downgrade still finds its
 * data.
 */
import { get, writable, type Readable } from "svelte/store";
import { loadExtensionState } from "../services/extension-state";
import { loadState, saveState } from "../config";
import { makePersistScheduler } from "../utils/persist-scheduler";

const LEGACY_STATE_ID = "workspace-groups";
const LEGACY_WORKSPACES_KEY = "workspaces";
const LEGACY_ACTIVE_WORKSPACE_ID_KEY = "activeWorkspaceId";
const PERSIST_DEBOUNCE_MS = 300;

/**
 * ParentWorkspace — the project-scope container that owns project-level
 * fields (path, color, git) and tracks which child workspaces are
 * members. New code should prefer the unified `Workspace` from
 * `../types` for individual workspace access; `ParentWorkspace` is
 * the persisted store entry for the project container itself.
 */
export interface ParentWorkspace {
  id: string;
  name: string;
  /** Root CWD — auto-adoption uses this as a longest-prefix ancestor match. */
  path: string;
  color: string;
  /** Ids of branched workspaces currently claimed by this workspace. */
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

async function persistNow(): Promise<void> {
  await saveState({
    parentWorkspaces: get(_workspaces),
    activeParentWorkspaceId: get(_activeWorkspaceId) ?? undefined,
  });
}

const _scheduler = makePersistScheduler(persistNow, PERSIST_DEBOUNCE_MS);
const schedulePersist = _scheduler.schedulePersist;

/**
 * Read state from disk and seed the stores. Idempotent — subsequent
 * calls are no-ops so tests can freely call the initializer.
 *
 * Reads from `AppState` (state.json). On first launch after the Stage 8
 * upgrade, if `AppState.parentWorkspaces` is missing, falls back to the
 * legacy extension-state file and writes the data forward into AppState
 * so subsequent loads are pure single-file reads.
 */
export async function loadWorkspaces(): Promise<void> {
  if (_loaded) return;
  _loaded = true;

  const state = await loadState();

  let workspaces: ParentWorkspace[] | null = null;
  let active: string | null = null;

  if (Array.isArray(state.parentWorkspaces)) {
    workspaces = state.parentWorkspaces;
    active =
      typeof state.activeParentWorkspaceId === "string"
        ? state.activeParentWorkspaceId
        : null;
  } else {
    const legacy = await loadExtensionState(LEGACY_STATE_ID);
    if (Array.isArray(legacy[LEGACY_WORKSPACES_KEY])) {
      workspaces = legacy[LEGACY_WORKSPACES_KEY] as ParentWorkspace[];
    }
    if (typeof legacy[LEGACY_ACTIVE_WORKSPACE_ID_KEY] === "string") {
      active = legacy[LEGACY_ACTIVE_WORKSPACE_ID_KEY] as string;
    }
    if (workspaces && workspaces.length > 0) {
      // Persist forward immediately so a future load reads from AppState.
      await saveState({
        parentWorkspaces: workspaces,
        activeParentWorkspaceId: active ?? undefined,
      });
    }
  }

  _workspaces.set((workspaces ?? []).map(normalizePersistedWorkspace));
  _activeWorkspaceId.set(active);
}

/** Flush pending writes — called from app close hooks. */
export async function flushWorkspaces(): Promise<void> {
  if (!_loaded) {
    _scheduler.cancel();
    return;
  }
  await _scheduler.flush();
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
  _scheduler.cancel();
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
