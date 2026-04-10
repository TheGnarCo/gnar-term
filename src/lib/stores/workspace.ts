import { writable, derived } from "svelte/store";
import type { Workspace } from "../types";
import { getAllPanes } from "../types";

export const workspaces = writable<Workspace[]>([]);
export const activeWorkspaceIdx = writable<number>(-1);

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
