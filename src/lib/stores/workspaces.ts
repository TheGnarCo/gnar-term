/**
 * Workspaces store — core's reactive source of truth for the persisted
 * Workspace list. Previously owned by the project-scope extension;
 * relocated to core in Stage 5 so commands, overlays, and row renderers
 * that manipulate workspaces no longer depend on the extension API
 * layer.
 *
 * Persistence reuses the existing per-extension JSON file at
 * `~/.config/gnar-term/extensions/workspace-groups/state.json` (loaded
 * via `loadExtensionState` / `saveExtensionState`). The on-disk key
 * (`"workspace-groups"`) is the persisted state id; renaming it would
 * orphan user data, so it stays even though the type is now called
 * Workspace internally. Stage 8 will move the data into
 * `GnarTermConfig`; until then we piggyback on the existing path so no
 * user data migrates in this stage.
 */
import { get, writable, type Readable } from "svelte/store";
import type { Workspace } from "../config";
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

interface LegacyWorkspaceShape extends Workspace {
  primaryWorkspaceId?: string;
  dashboardWorkspaceId?: string;
}

/**
 * Load-bearing for the main → current upgrade path: settings files
 * written before the group-unification rename still carry
 * `primaryWorkspaceId` / `dashboardWorkspaceId`. Removing this shim
 * would silently drop pointer fields, leaving workspaces without valid
 * nested-workspace references on first cold start after upgrade.
 *
 * This is INTENTIONALLY NOT shared with `renameWorkspaceFields` in
 * `v3-archive-shape.ts`. This version operates on live-store entries
 * and ALSO resets `nestedWorkspaceIds: []` (the workspace:created
 * listener rebuilds them at runtime); the archive version operates on
 * `workspaceDefs` shape and must NOT reset that field. Any new legacy
 * key added to one must be manually audited for applicability to the
 * other.
 *
 * Removal target: Stage 8, when the data moves into `GnarTermConfig`
 * and a schemaVersion gate provably rewrites the persisted file.
 */
function renameLegacyWorkspaceFields(g: Workspace): Workspace {
  const legacy = g as LegacyWorkspaceShape;
  const {
    primaryWorkspaceId,
    dashboardWorkspaceId,
    primaryNestedWorkspaceId,
    dashboardNestedWorkspaceId,
    ...rest
  } = legacy;
  return {
    ...rest,
    nestedWorkspaceIds: [],
    ...(primaryNestedWorkspaceId !== undefined
      ? { primaryNestedWorkspaceId }
      : primaryWorkspaceId !== undefined
        ? { primaryNestedWorkspaceId: primaryWorkspaceId }
        : {}),
    ...(dashboardNestedWorkspaceId !== undefined
      ? { dashboardNestedWorkspaceId }
      : dashboardWorkspaceId !== undefined
        ? { dashboardNestedWorkspaceId: dashboardWorkspaceId }
        : {}),
  };
}

const _workspaces = writable<Workspace[]>([]);
export const workspacesStore: Readable<Workspace[]> = _workspaces;

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
    ? (state[WORKSPACES_KEY] as Workspace[])
    : [];
  const order = Array.isArray(state[WORKSPACE_ORDER_KEY])
    ? (state[WORKSPACE_ORDER_KEY] as string[])
    : [];
  const active =
    typeof state[ACTIVE_WORKSPACE_ID_KEY] === "string"
      ? (state[ACTIVE_WORKSPACE_ID_KEY] as string)
      : null;
  // NestedWorkspace ids are regenerated on each run, so drop any stale values;
  // the workspace:created listener rebuilds them from metadata.parentWorkspaceId.
  // Older persisted data used `primaryWorkspaceId`/`dashboardWorkspaceId`;
  // promote them to the new names so consumers see only the renamed fields.
  _workspaces.set(workspaces.map(renameLegacyWorkspaceFields));
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

export function getWorkspaces(): Workspace[] {
  return get(_workspaces);
}

export function getWorkspace(id: string): Workspace | undefined {
  return getWorkspaces().find((w) => w.id === id);
}

export function setWorkspaces(next: Workspace[]): void {
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
