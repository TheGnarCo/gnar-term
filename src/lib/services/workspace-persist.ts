/**
 * Single-writer persistence for the workspaces store.
 *
 * Lives in its own module so workspace-service, pane-service, and the boot
 * path can all call `schedulePersist()` without pulling in each other's
 * circular import edges.
 *
 * `persistWorkspaces` serializes the entire `workspaces` runtime store
 * verbatim — anchors carry their grouping fields (memberWorkspaceIds, color,
 * worktree, ...) and members carry their `anchorWorkspaceId` back-reference.
 * The active id prefers the explicit row-level pointer
 * (`activeAnchorWorkspaceId`, what the sidebar tracks) and falls back to the
 * focused-tab workspace (`activeWorkspaceIdx`) when unset.
 */
import { get } from "svelte/store";
import { workspaces, activeWorkspaceIdx } from "../stores/workspace";
import { getActiveAnchorWorkspaceId } from "../stores/workspace";
import { serializeWorkspace, saveState, type WorkspaceDef } from "../config";
import { makePersistScheduler } from "../utils/persist-scheduler";

const PERSIST_DELAY = 2000;

export async function persistWorkspaces(): Promise<void> {
  const wsList = get(workspaces);
  const defs: WorkspaceDef[] = wsList.map((ws) => serializeWorkspace(ws));

  const idx = get(activeWorkspaceIdx);
  const runtimeActiveId =
    idx >= 0 && idx < wsList.length ? (wsList[idx]?.id ?? null) : null;
  const activeId = getActiveAnchorWorkspaceId() ?? runtimeActiveId;

  await saveState({
    workspaces: defs,
    activeWorkspaceId: activeId ?? undefined,
  });
}

const _scheduler = makePersistScheduler(persistWorkspaces, PERSIST_DELAY);
export const schedulePersist = _scheduler.schedulePersist;
/** Force-flush any pending persist immediately (shutdown hooks). */
export const flushPersist = _scheduler.flush;
/** Cancel any pending persist without writing (test resets). */
export const cancelPersist = _scheduler.cancel;
