/**
 * Workspace Groups store — core's reactive source of truth for the
 * persisted Workspace list. Previously owned by the
 * project-scope extension; relocated to core in Stage 5 so commands,
 * overlays, and row renderers that manipulate groups no longer depend
 * on the extension API layer.
 *
 * Persistence reuses the existing per-extension JSON file at
 * `~/.config/gnar-term/extensions/workspace-groups/state.json` (loaded
 * via `loadExtensionState` / `saveExtensionState`). Stage 8 will move
 * the data into `GnarTermConfig`; until then we piggyback on the
 * existing path so no user data migrates in this stage.
 */
import { get, writable, type Readable } from "svelte/store";
import type { Workspace } from "../config";
import {
  loadExtensionState,
  saveExtensionState,
} from "../services/extension-state";

const STATE_ID = "workspace-groups";
const WORKSPACE_GROUPS_KEY = "workspaces";
const WORKSPACE_GROUP_ORDER_KEY = "workspaceOrder";
const ACTIVE_GROUP_ID_KEY = "activeGroupId";
const PERSIST_DEBOUNCE_MS = 300;

interface LegacyWorkspaceShape extends Workspace {
  primaryWorkspaceId?: string;
  dashboardWorkspaceId?: string;
}

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

const _groups = writable<Workspace[]>([]);
export const workspacesStore: Readable<Workspace[]> = _groups;

const _groupOrder = writable<string[]>([]);

const _activeGroupId = writable<string | null>(null);

let _loaded = false;
let _persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(): void {
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    void persistNow();
  }, PERSIST_DEBOUNCE_MS);
}

async function persistNow(): Promise<void> {
  const payload: Record<string, unknown> = {
    [WORKSPACE_GROUPS_KEY]: get(_groups),
    [WORKSPACE_GROUP_ORDER_KEY]: get(_groupOrder),
    [ACTIVE_GROUP_ID_KEY]: get(_activeGroupId),
  };
  await saveExtensionState(STATE_ID, payload);
}

/**
 * Read state from disk and seed the stores. Idempotent — subsequent
 * calls are no-ops so tests can freely call the initializer.
 */
export async function loadWorkspaces(): Promise<void> {
  if (_loaded) return;
  _loaded = true;
  const state = await loadExtensionState(STATE_ID);
  const groups = Array.isArray(state[WORKSPACE_GROUPS_KEY])
    ? (state[WORKSPACE_GROUPS_KEY] as Workspace[])
    : [];
  const order = Array.isArray(state[WORKSPACE_GROUP_ORDER_KEY])
    ? (state[WORKSPACE_GROUP_ORDER_KEY] as string[])
    : [];
  const active =
    typeof state[ACTIVE_GROUP_ID_KEY] === "string"
      ? (state[ACTIVE_GROUP_ID_KEY] as string)
      : null;
  // NestedWorkspace ids are regenerated on each run, so drop any stale values;
  // the workspace:created listener rebuilds them from metadata.parentWorkspaceId.
  // Older persisted data used `primaryWorkspaceId`/`dashboardWorkspaceId`;
  // promote them to the new names so consumers see only the renamed fields.
  _groups.set(groups.map(renameLegacyWorkspaceFields));
  _groupOrder.set(order);
  _activeGroupId.set(active);
}

/** Flush pending writes — called from app close hooks. */
export async function flushWorkspaces(): Promise<void> {
  if (_persistTimer) {
    clearTimeout(_persistTimer);
    _persistTimer = null;
  }
  if (_loaded) await persistNow();
}

export function getWorkspaces(): Workspace[] {
  return get(_groups);
}

export function getWorkspace(id: string): Workspace | undefined {
  return getWorkspaces().find((g) => g.id === id);
}

export function setWorkspaces(next: Workspace[]): void {
  _groups.set(next);
  schedulePersist();
}

export function getActiveWorkspaceId(): string | null {
  return get(_activeGroupId);
}

export function setActiveWorkspaceId(id: string | null): void {
  _activeGroupId.set(id);
  schedulePersist();
}

/** Test hook — reset in-memory state so tests start clean. */
export function resetWorkspacesForTest(): void {
  if (_persistTimer) {
    clearTimeout(_persistTimer);
    _persistTimer = null;
  }
  _groups.set([]);
  _groupOrder.set([]);
  _activeGroupId.set(null);
  _loaded = false;
}
