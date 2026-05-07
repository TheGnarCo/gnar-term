/**
 * Single-writer persistence for the unified workspaces store.
 *
 * Lives in its own module so workspace-service and
 * workspace-runtime-service can both call `schedulePersist()` without
 * pulling in each other's circular import edges.
 *
 * `persistWorkspaces` serializes the entire `_workspaces` runtime store
 * verbatim — root entries already carry Workspace-level fields (path,
 * color, isGit, createdAt, lock, dashboard ref) and child entries carry
 * their structural fields. The active id prefers the explicit pointer
 * maintained by `setActiveWorkspaceId` (what the sidebar tracks) and
 * falls back to the runtime active (the focused tab) when unset.
 */
import { get } from "svelte/store";
import {
  workspaces,
  activeWorkspaceIdx,
  serializeWorkspace,
  getActiveWorkspaceId,
} from "../stores/workspace";
import { saveState, type WorkspaceDef } from "../config";
import { makePersistScheduler } from "../utils/persist-scheduler";

const PERSIST_DELAY = 2000;

export async function persistWorkspaces(): Promise<void> {
  const wsList = get(workspaces);
  const defs: WorkspaceDef[] = wsList.map((ws) => serializeWorkspace(ws));

  const idx = get(activeWorkspaceIdx);
  const runtimeActiveId =
    idx >= 0 && idx < wsList.length ? (wsList[idx]?.id ?? null) : null;
  const activeId = getActiveWorkspaceId() ?? runtimeActiveId;

  await saveState({
    workspaces: defs,
    activeWorkspaceId: activeId ?? undefined,
  });
}

const _scheduler = makePersistScheduler(persistWorkspaces, PERSIST_DELAY);
export const schedulePersist = _scheduler.schedulePersist;
