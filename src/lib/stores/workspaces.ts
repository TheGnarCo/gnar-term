/**
 * Workspaces store — core's reactive source of truth for the persisted
 * parent workspace list. Previously owned by the project-scope extension;
 * relocated to core in Stage 5 so commands, overlays, and row renderers
 * that manipulate workspaces no longer depend on the extension API
 * layer.
 *
 * Persistence reuses the existing per-extension JSON file at
 * `~/.config/gnar-term/extensions/workspace-groups/state.json` (loaded
 * via `loadExtensionState` / `saveExtensionState`). The on-disk key
 * (`"workspace-groups"`) is the persisted state id; renaming it would
 * orphan user data, so it stays. Stage 8 will move the data into
 * `GnarTermConfig`; until then we piggyback on the existing path so no
 * user data migrates in this stage.
 */
import { get, writable, type Readable } from "svelte/store";
import {
  loadExtensionState,
  saveExtensionState,
} from "../services/extension-state";
import { makePersistScheduler } from "../utils/persist-scheduler";

const STATE_ID = "workspace-groups";
const WORKSPACES_KEY = "workspaces";
const WORKSPACE_ORDER_KEY = "workspaceOrder";
const ACTIVE_WORKSPACE_ID_KEY = "activeWorkspaceId";
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

/**
 * Round-tripped through the persisted JSON for downgrade compatibility
 * with settings files written by the legacy extension-state code
 * (`extension-state.ts` maps `projectOrder → workspaceOrder`). The
 * loaded value is intentionally never read at runtime — `rootRowOrder`
 * (`./root-row-order.ts`) drives sidebar ordering — but it must persist
 * unchanged so a downgrade or a partial migration does not silently
 * lose ordering.
 *
 * Removal target: Stage 8, when the data moves into `GnarTermConfig`
 * and a schemaVersion gate provably rewrites the persisted file.
 */
const _workspaceOrder = writable<string[]>([]);

const _activeWorkspaceId = writable<string | null>(null);

let _loaded = false;

async function persistNow(): Promise<void> {
  const payload: Record<string, unknown> = {
    [WORKSPACES_KEY]: get(_workspaces),
    [WORKSPACE_ORDER_KEY]: get(_workspaceOrder),
    [ACTIVE_WORKSPACE_ID_KEY]: get(_activeWorkspaceId),
  };
  await saveExtensionState(STATE_ID, payload);
}

const _scheduler = makePersistScheduler(persistNow, PERSIST_DEBOUNCE_MS);
const schedulePersist = _scheduler.schedulePersist;

/**
 * Read state from disk and seed the stores. Idempotent — subsequent
 * calls are no-ops so tests can freely call the initializer.
 */
export async function loadWorkspaces(): Promise<void> {
  if (_loaded) return;
  _loaded = true;
  const state = await loadExtensionState(STATE_ID);
  const workspaces = Array.isArray(state[WORKSPACES_KEY])
    ? (state[WORKSPACES_KEY] as ParentWorkspace[])
    : [];
  const order = Array.isArray(state[WORKSPACE_ORDER_KEY])
    ? (state[WORKSPACE_ORDER_KEY] as string[])
    : [];
  const active =
    typeof state[ACTIVE_WORKSPACE_ID_KEY] === "string"
      ? (state[ACTIVE_WORKSPACE_ID_KEY] as string)
      : null;
  // Workspace ids are regenerated on each run, so drop any stale values;
  // the workspace:created listener rebuilds them from metadata.parentWorkspaceId.
  _workspaces.set(workspaces.map(normalizePersistedWorkspace));
  _workspaceOrder.set(order);
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
  _workspaceOrder.set([]);
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
