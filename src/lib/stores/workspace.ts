import { writable, derived } from "svelte/store";
import type { Workspace } from "../types";
import { getAllPanes } from "../types";

export const workspaces = writable<Workspace[]>([]);
export const activeWorkspaceIdx = writable<number>(-1);

/**
 * Id of the currently-active pseudo-workspace (e.g. the Global Agentic
 * Dashboard), or `null` when a real workspace is active. Pseudo-workspaces
 * are registered via `registerPseudoWorkspace` and do not live in the
 * `workspaces` array — they're rendered from the pseudo-workspace
 * registry. Activation is mutually exclusive with `activeWorkspaceIdx`:
 * setting this to a non-null id hides every real workspace view and
 * mounts the pseudo's body instead.
 */
export const activePseudoWorkspaceId = writable<string | null>(null);

/**
 * When non-null, holds the surface ID of the pane that is "zoomed" to fill
 * the full workspace area. All other panes are hidden (but kept mounted) so
 * terminal state is preserved. Cleared on workspace switch.
 */
export const zoomedSurfaceId = writable<string | null>(null);

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
