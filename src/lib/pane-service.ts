/**
 * Pane Service — pure logic for pane/surface manipulation.
 *
 * These functions operate on workspace data structures directly,
 * without Svelte store dependencies. The caller (App.svelte)
 * is responsible for triggering reactivity via workspaces.update().
 */

import { invoke } from "@tauri-apps/api/core";
import type { Workspace, Pane, Surface, SplitNode } from "./types";
import {
  uid,
  getAllPanes,
  getAllSurfaces,
  isTerminalSurface,
  isHarnessSurface,
  findParentSplit,
  replaceNodeInTree,
} from "./types";
import { createTerminalSurface } from "./terminal-service";

/** Dispose a terminal/harness surface — clean up xterm + kill PTY */
export function disposeSurface(surface: Surface): void {
  if (isTerminalSurface(surface) || isHarnessSurface(surface)) {
    surface.terminal.dispose();
    if (surface.ptyId >= 0) {
      invoke("kill_pty", { ptyId: surface.ptyId }).catch(() => {});
    }
  }
}

/** Remove a surface from a pane. Returns the new active surface ID, or null if pane is now empty. */
export function removeSurfaceFromPane(
  pane: Pane,
  surfaceIdx: number,
): string | null {
  const surface = pane.surfaces[surfaceIdx];
  disposeSurface(surface);
  pane.surfaces.splice(surfaceIdx, 1);

  if (pane.surfaces.length === 0) return null;
  const newIdx = Math.min(surfaceIdx, pane.surfaces.length - 1);
  pane.activeSurfaceId = pane.surfaces[newIdx].id;
  return pane.activeSurfaceId;
}

/** Collapse a pane out of the split tree. Returns true if workspace should be removed. */
export function collapsePaneFromTree(ws: Workspace, pane: Pane): boolean {
  pane.resizeObserver?.disconnect();

  if (ws.splitRoot.type === "pane" && ws.splitRoot.pane.id === pane.id) {
    return true; // This was the only pane — caller should remove workspace
  }

  const parentInfo = findParentSplit(ws.splitRoot, pane.id);
  if (parentInfo && parentInfo.parent.type === "split") {
    const sibling = parentInfo.parent.children[parentInfo.index === 0 ? 1 : 0];
    if (ws.splitRoot === parentInfo.parent) {
      ws.splitRoot = sibling;
    } else {
      replaceNodeInTree(ws.splitRoot, parentInfo.parent, sibling);
    }
    ws.activePaneId = getAllPanes(ws.splitRoot)[0]?.id ?? null;
  }
  return false;
}

/** Split a pane in the given direction, creating a new terminal surface in the new pane. */
export async function splitPane(
  ws: Workspace,
  paneId: string,
  direction: "horizontal" | "vertical",
  cwd?: string,
): Promise<Surface> {
  const activeP = getAllPanes(ws.splitRoot).find((p) => p.id === paneId);
  if (!activeP) throw new Error(`Pane ${paneId} not found`);

  const newPane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
  const surface = await createTerminalSurface(newPane, cwd);

  const newSplit: SplitNode = {
    type: "split",
    direction,
    children: [
      { type: "pane", pane: activeP },
      { type: "pane", pane: newPane },
    ],
    ratio: 0.5,
  };

  if (ws.splitRoot.type === "pane" && ws.splitRoot.pane.id === activeP.id) {
    ws.splitRoot = newSplit;
  } else {
    const parentInfo = findParentSplit(ws.splitRoot, activeP.id);
    if (parentInfo && parentInfo.parent.type === "split") {
      parentInfo.parent.children[parentInfo.index] = newSplit;
    }
  }
  ws.activePaneId = newPane.id;
  return surface;
}

/** Dispose all surfaces in a workspace (for close/cleanup). */
export function disposeAllSurfaces(ws: Workspace): void {
  for (const pane of getAllPanes(ws.splitRoot)) {
    pane.resizeObserver?.disconnect();
  }
  for (const s of getAllSurfaces(ws)) {
    disposeSurface(s);
  }
}

/** Count active PTY processes in a workspace. */
export function countActivePtys(ws: Workspace): number {
  return getAllSurfaces(ws).filter(
    (s) => (isTerminalSurface(s) || isHarnessSurface(s)) && s.ptyId >= 0,
  ).length;
}
