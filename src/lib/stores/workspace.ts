import { writable, derived, get } from "svelte/store";
import type { Workspace, Pane, Surface } from "../types";
import { getAllPanes, isAnchorWorkspace } from "../types";

export const workspaces = writable<Workspace[]>([]);
export const activeWorkspaceIdx = writable<number>(-1);

/**
 * A typed view over an anchor `Workspace` row — a workspace that owns a group
 * (or is standalone). The grouping fields are surfaced as required to make
 * anchor-side code total; runtime rows still carry them as optional.
 */
export type AnchorWorkspace = Workspace & {
  memberWorkspaceIds: string[];
};

/**
 * Derived projection of `workspaces` filtered to anchors (workspaces with no
 * `anchorWorkspaceId`). Members live nested under their anchor and are
 * excluded here.
 */
export const anchorWorkspacesStore = derived(workspaces, ($w) =>
  $w.filter(isAnchorWorkspace),
);

/**
 * Row-level selection pointer — the workspace whose row is selected in the
 * sidebar. Distinct from the focused-tab coordinate (`activeWorkspaceIdx`):
 * the two are kept in sync but answer different questions (which row is
 * highlighted vs. which tab has focus).
 */
const _activeAnchorWorkspaceId = writable<string | null>(null);

/** Read/write facade over the row-level selection pointer. */
export const activeAnchorWorkspaceId = {
  subscribe: _activeAnchorWorkspaceId.subscribe,
  set: _activeAnchorWorkspaceId.set,
};

export function getActiveAnchorWorkspaceId(): string | null {
  return get(_activeAnchorWorkspaceId);
}

export function setActiveAnchorWorkspaceId(id: string | null): void {
  _activeAnchorWorkspaceId.set(id);
}

/**
 * Surface id of the currently maximized ("zoomed") pane, or null when no pane
 * is zoomed. Ephemeral UI state — not persisted.
 */
export const zoomedSurfaceId = writable<string | null>(null);

export const activeWorkspace = derived(
  [workspaces, activeWorkspaceIdx],
  ([$ws, $idx]) => $ws[$idx] ?? null
);

export const activePane = derived(
  [activeWorkspace],
  ([$ws]) => {
    if (!$ws) return null;
    const panes = getAllPanes($ws.splitRoot);
    return panes.find(p => p.id === $ws.activePaneId) ?? null;
  }
);

export const activeSurface = derived(
  [activePane],
  ([$pane]) => {
    if (!$pane) return null;
    return $pane.surfaces.find(s => s.id === $pane.activeSurfaceId) ?? null;
  }
);
