import { writable, derived, get } from "svelte/store";
import type { Workspace, Pane, Surface } from "../types";
import { getAllPanes } from "../types";

export const workspaces = writable<Workspace[]>([]);
export const activeWorkspaceIdx = writable<number>(-1);

/** Trigger Svelte reactivity after mutating workspace data in place. */
export function notifyWorkspacesChanged(): void {
  workspaces.update((l) => [...l]);
}

/** Reorder a workspace from one index to another, keeping activeWorkspaceIdx in sync. */
export function reorderWorkspace(fromIdx: number, toIdx: number): void {
  workspaces.update((list) => {
    if (
      fromIdx < 0 ||
      fromIdx >= list.length ||
      toIdx < 0 ||
      toIdx >= list.length ||
      fromIdx === toIdx
    )
      return list;
    const [item] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, item);

    // Keep the active index pointing at the same workspace
    activeWorkspaceIdx.update((active) => {
      if (active === fromIdx) return toIdx;
      if (fromIdx < active && toIdx >= active) return active - 1;
      if (fromIdx > active && toIdx <= active) return active + 1;
      return active;
    });

    return [...list];
  });
}

/**
 * Reorder workspaces within a project section. Uses local indices
 * (position within the project's workspace list), resolves to global
 * indices for the runtime store, and persists to state.json.
 */
export async function reorderProjectWorkspaces(
  projectId: string,
  fromLocal: number,
  toLocal: number,
): Promise<void> {
  // Get the global indices for the workspaces in this project
  const list = get(workspaces);
  const projectEntries = list
    .map((ws, idx) => ({ ws, idx }))
    .filter(({ ws }) => ws.record?.projectId === projectId);

  if (
    fromLocal < 0 ||
    fromLocal >= projectEntries.length ||
    toLocal < 0 ||
    toLocal >= projectEntries.length ||
    fromLocal === toLocal
  )
    return;

  const fromGlobal = projectEntries[fromLocal].idx;
  const toGlobal = projectEntries[toLocal].idx;
  reorderWorkspace(fromGlobal, toGlobal);

  // Persist the order in state.json
  const { reorderWorkspacesInProject, saveState } = await import("../state");
  reorderWorkspacesInProject(projectId, fromLocal, toLocal);
  await saveState();
}

/**
 * Reorder floating workspaces. Uses local indices (position within
 * the floating list), resolves to global indices, and persists.
 */
export async function reorderFloating(
  fromLocal: number,
  toLocal: number,
): Promise<void> {
  const list = get(workspaces);
  const floatingEntries = list
    .map((ws, idx) => ({ ws, idx }))
    .filter(({ ws }) => ws.record && !ws.record.projectId);

  if (
    fromLocal < 0 ||
    fromLocal >= floatingEntries.length ||
    toLocal < 0 ||
    toLocal >= floatingEntries.length ||
    fromLocal === toLocal
  )
    return;

  const fromGlobal = floatingEntries[fromLocal].idx;
  const toGlobal = floatingEntries[toLocal].idx;
  reorderWorkspace(fromGlobal, toGlobal);

  const { reorderFloatingWorkspaces, saveState } = await import("../state");
  reorderFloatingWorkspaces(fromLocal, toLocal);
  await saveState();
}

export const activeWorkspace = derived(
  [workspaces, activeWorkspaceIdx],
  ([$ws, $idx]) => $ws[$idx] ?? null,
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

/** Floating workspaces (not attached to any project) — for sidebar display */
export const floatingWorkspaces = derived(workspaces, ($ws) =>
  $ws
    .map((ws, idx) => ({ ws, idx }))
    .filter(({ ws }) => ws.record && !ws.record.projectId),
);

/** Workspaces grouped by projectId — for sidebar and dashboard use */
export const projectWorkspaceMap = derived(workspaces, ($ws) => {
  const map = new Map<string, { ws: Workspace; idx: number }[]>();
  $ws.forEach((ws, idx) => {
    if (ws.record?.projectId) {
      const list = map.get(ws.record.projectId) || [];
      list.push({ ws, idx });
      map.set(ws.record.projectId, list);
    }
  });
  return map;
});
