import { get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import {
  workspaces,
  activeWorkspaceIdx,
  activeWorkspace,
  activePane,
  activeSurface,
  zoomedSurfaceId,
} from "../stores/workspace";
import { activeWorkspaceId } from "../stores/workspace";
import { theme } from "../stores/theme";
import { createTerminalSurface } from "../terminal-service";
import {
  uid,
  getAllPanes,
  getAllSurfaces,
  isTerminalSurface,
  findParentSplit,
  replaceNodeInTree,
  type Workspace,
  type Pane,
  type SplitNode,
} from "../types";
import {
  schedulePersist,
  collapseEmptyPaneInWorkspace,
} from "./workspace-runtime-service";
import { removeRootRow } from "../stores/root-row-order";
import { removeChildFromAllWorkspaces } from "./workspace-service";
import { handleWorkspaceClosed as gitStatusWorkspaceClosed } from "./git-status-service";
import { safeFocus, getCwdForSurface } from "./service-helpers";
import { eventBus } from "./event-bus";

export { zoomedSurfaceId };

/**
 * Toggle zoom for the given surface. If the surface is already zoomed,
 * restores the normal split layout. If a different surface is zoomed (or
 * none), zooms to the given surface.
 */
export function togglePaneZoom(surfaceId: string): void {
  zoomedSurfaceId.update((current) =>
    current === surfaceId ? null : surfaceId,
  );
}

/**
 * Split the given pane (or the active pane if none found) without attaching
 * any surface to the new pane. Returns the new empty pane, or null if there
 * was nothing to split from. Callers decide what surface (if any) to push.
 *
 * Used by `splitPane` (which then creates a terminal) and by MCP tools that
 * need to split and drop a non-terminal surface into the new pane.
 */
export function splitPaneEmpty(
  paneId: string,
  direction: "horizontal" | "vertical",
): { newPane: Pane; parentPaneId: string } | null {
  const ws = get(activeWorkspace);
  if (!ws) return null;
  const activeP =
    getAllPanes(ws.paneLayout).find((p) => p.id === paneId) ?? get(activePane);
  if (!activeP) return null;

  const newPane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
  const newSplit: SplitNode = {
    type: "split",
    direction,
    children: [
      { type: "pane", pane: activeP },
      { type: "pane", pane: newPane },
    ],
    ratio: 0.5,
  };

  if (ws.paneLayout.type === "pane" && ws.paneLayout.pane.id === activeP.id) {
    ws.paneLayout = newSplit;
  } else {
    const parentInfo = findParentSplit(ws.paneLayout, activeP.id);
    if (parentInfo && parentInfo.parent.type === "split") {
      parentInfo.parent.children[parentInfo.index] = newSplit;
    }
  }
  ws.activePaneId = newPane.id;
  workspaces.update((l) => l);
  eventBus.emit({
    type: "pane:split",
    parentPaneId: activeP.id,
    newPaneId: newPane.id,
    direction,
  });
  return { newPane, parentPaneId: activeP.id };
}

export async function splitPane(
  paneId: string,
  direction: "horizontal" | "vertical",
) {
  const ws = get(activeWorkspace);
  const sourcePane =
    ws &&
    (getAllPanes(ws.paneLayout).find((p) => p.id === paneId) ??
      get(activePane));
  const sourceSurface = sourcePane
    ? sourcePane.surfaces.find((s) => s.id === sourcePane.activeSurfaceId)
    : null;
  const result = splitPaneEmpty(paneId, direction);
  if (!result) return;
  const cwd = await getCwdForSurface(sourceSurface);
  const surface = await createTerminalSurface(result.newPane, cwd);
  workspaces.update((l) => l);
  void safeFocus(surface);
  schedulePersist();
}

export function removePane(ws: Workspace, pane: Pane) {
  const paneId = pane.id;
  const wsId = ws.id;
  pane.resizeObserver?.disconnect();
  if (ws.paneLayout.type === "pane" && ws.paneLayout.pane.id === pane.id) {
    const wsList = get(workspaces);
    const wsIdx = wsList.indexOf(ws);
    workspaces.update((list) => list.filter((w) => w.id !== ws.id));
    eventBus.emit({ type: "pane:closed", id: paneId, workspaceId: wsId });
    // If this was the last workspace, leave the store empty so App.svelte
    // renders <EmptySurface />. New workspaces must come from the New dialog
    // (with a directory) or a config-driven WorkspaceTemplate — never from a
    // naked auto-create here.
    if (get(workspaces).length > 0) {
      const newIdx = Math.min(wsIdx, get(workspaces).length - 1);
      const targetId = get(workspaces)[newIdx]?.id ?? null;
      activeWorkspaceId.set(targetId);
    }
    return;
  }
  const parentInfo = findParentSplit(ws.paneLayout, pane.id);
  if (parentInfo && parentInfo.parent.type === "split") {
    const sibling = parentInfo.parent.children[parentInfo.index === 0 ? 1 : 0];
    if (ws.paneLayout === parentInfo.parent) {
      ws.paneLayout = sibling;
    } else {
      replaceNodeInTree(ws.paneLayout, parentInfo.parent, sibling);
    }
    ws.activePaneId = getAllPanes(ws.paneLayout)[0]?.id ?? null;
  }
  workspaces.update((l) => l);
  eventBus.emit({ type: "pane:closed", id: paneId, workspaceId: wsId });
  void safeFocus(get(activeSurface));
}

export function closePane(paneId: string) {
  const ws = get(activeWorkspace);
  if (!ws) return;
  const pane = getAllPanes(ws.paneLayout).find((p) => p.id === paneId);
  if (!pane) return;
  // Snapshot surface ids so we can emit `surface:closed` after the
  // splice. Without this, agent-detection-service keeps tracking
  // surfaces that no longer exist (their bot status lingers on the
  // workspace banner).
  const closedSurfaceIds: string[] = pane.surfaces.map((s) => s.id);
  for (const s of [...pane.surfaces]) {
    if (isTerminalSurface(s)) {
      s.terminal.dispose();
      // PTY may already have exited — safe to ignore
      if (s.ptyId >= 0) invoke("kill_pty", { ptyId: s.ptyId }).catch(() => {});
    }
  }
  pane.surfaces = [];
  for (const surfaceId of closedSurfaceIds) {
    eventBus.emit({ type: "surface:closed", id: surfaceId, paneId });
  }
  removePane(ws, pane);
  schedulePersist();
}

export function dismissPane(paneId: string): void {
  const ws = get(activeWorkspace);
  if (!ws) return;
  const pane = getAllPanes(ws.paneLayout).find((p) => p.id === paneId);
  if (!pane) return;
  pane.exitedSurface = undefined;
  removePane(ws, pane);
  schedulePersist();
}

export async function relaunchPane(paneId: string): Promise<void> {
  const ws = get(activeWorkspace);
  if (!ws) return;
  const pane = getAllPanes(ws.paneLayout).find((p) => p.id === paneId);
  if (!pane || !pane.exitedSurface) return;
  const { definedCommand, cwd } = pane.exitedSurface;
  pane.exitedSurface = undefined;
  workspaces.update((l) => l);
  const surface = await createTerminalSurface(pane, cwd);
  if (definedCommand) {
    surface.definedCommand = definedCommand;
    surface.startupCommand = definedCommand;
    surface.title = definedCommand;
  }
  workspaces.update((l) => l);
  void safeFocus(surface);
}

export function focusPane(paneId: string) {
  const ws = get(activeWorkspace);
  if (!ws || ws.activePaneId === paneId) return;
  const previousId = ws.activePaneId;
  ws.activePaneId = paneId;
  workspaces.update((l) => l);
  eventBus.emit({ type: "pane:focused", id: paneId, previousId });
}

/**
 * Move a single surface out of its source pane into a brand-new pane
 * that sits next to `targetPaneId` in the split tree. Backs the
 * cross-pane drop in tab drag-and-drop ("drag tab onto another pane").
 *
 * - source pane goes empty → it collapses out of the split tree
 *   (terminal/surface NOT disposed; it lives on in the new pane)
 * - target pane is the paneLayout → the wrapping split becomes the root
 * - target pane is nested → its slot in the parent split is replaced
 *
 * No-op when source === target, when either pane can't be found, or
 * when the surface isn't in the source pane.
 */
export function splitPaneWithSurface(
  surfaceId: string,
  sourcePaneId: string,
  targetPaneId: string,
  direction: "horizontal" | "vertical" = "horizontal",
  before = false,
): void {
  const ws = get(activeWorkspace);
  if (!ws) return;
  const allPanes = getAllPanes(ws.paneLayout);
  const sourcePane = allPanes.find((p) => p.id === sourcePaneId);
  const targetPane = allPanes.find((p) => p.id === targetPaneId);
  if (!sourcePane || !targetPane) return;

  const surfaceIdx = sourcePane.surfaces.findIndex((s) => s.id === surfaceId);
  if (surfaceIdx === -1) return;
  const [surface] = sourcePane.surfaces.splice(surfaceIdx, 1);
  if (!surface) return;

  if (sourcePane.activeSurfaceId === surfaceId) {
    sourcePane.activeSurfaceId = sourcePane.surfaces[0]?.id ?? null;
  }

  const newPane: Pane = {
    id: uid(),
    surfaces: [surface],
    activeSurfaceId: surface.id,
  };

  const newSplit: SplitNode = {
    type: "split",
    direction,
    children: before
      ? [
          { type: "pane", pane: newPane },
          { type: "pane", pane: targetPane },
        ]
      : [
          { type: "pane", pane: targetPane },
          { type: "pane", pane: newPane },
        ],
    ratio: 0.5,
  };

  if (ws.paneLayout.type === "pane" && ws.paneLayout.pane.id === targetPaneId) {
    ws.paneLayout = newSplit;
  } else {
    const parentInfo = findParentSplit(ws.paneLayout, targetPaneId);
    if (parentInfo && parentInfo.parent.type === "split") {
      parentInfo.parent.children[parentInfo.index] = newSplit;
    }
  }

  // Collapse the source pane if the move emptied it. The surface is
  // already moved into the new pane, so we explicitly skip terminal
  // disposal (unlike removePane → closePane which kills the PTY).
  if (sourcePane.surfaces.length === 0) {
    if (
      ws.paneLayout.type === "pane" &&
      ws.paneLayout.pane.id === sourcePaneId
    ) {
      // Source was the root and is now empty — but we just made the
      // new split (containing target + new pane) the new root above
      // when target === root, which excludes this branch. Reaching
      // here means source was root AND target was nested, which is
      // structurally impossible in a binary split tree. Bail safely.
      return;
    }
    const srcParentInfo = findParentSplit(ws.paneLayout, sourcePaneId);
    if (srcParentInfo && srcParentInfo.parent.type === "split") {
      const sibling =
        srcParentInfo.parent.children[srcParentInfo.index === 0 ? 1 : 0]!;
      if (ws.paneLayout === srcParentInfo.parent) {
        ws.paneLayout = sibling;
      } else {
        replaceNodeInTree(ws.paneLayout, srcParentInfo.parent, sibling);
      }
    }
  }

  ws.activePaneId = newPane.id;
  workspaces.update((l) => l);
  schedulePersist();
}

/**
 * Move a surface from its source pane into an existing target pane's tab
 * list. Source pane collapses if it becomes empty. Backs the tab-bar drop
 * in drag-and-drop ("drag tab onto another pane's tab bar").
 */
export function mergeTabToPane(
  surfaceId: string,
  sourcePaneId: string,
  targetPaneId: string,
): void {
  if (sourcePaneId === targetPaneId) return;
  const ws = get(activeWorkspace);
  if (!ws) return;
  const allPanes = getAllPanes(ws.paneLayout);
  const sourcePane = allPanes.find((p) => p.id === sourcePaneId);
  const targetPane = allPanes.find((p) => p.id === targetPaneId);
  if (!sourcePane || !targetPane) return;

  const idx = sourcePane.surfaces.findIndex((s) => s.id === surfaceId);
  if (idx === -1) return;
  const [surface] = sourcePane.surfaces.splice(idx, 1);
  if (!surface) return;
  if (sourcePane.activeSurfaceId === surfaceId) {
    sourcePane.activeSurfaceId = sourcePane.surfaces[0]?.id ?? null;
  }
  if (
    sourcePane.surfaces.length === 0 &&
    !(ws.paneLayout.type === "pane" && ws.paneLayout.pane.id === sourcePaneId)
  ) {
    collapseEmptyPaneInWorkspace(ws, sourcePaneId);
  }
  targetPane.surfaces.push(surface);
  targetPane.activeSurfaceId = surface.id;
  ws.activePaneId = targetPane.id;
  workspaces.update((l) => l);
  schedulePersist();
}

export function reorderTab(paneId: string, fromIdx: number, toIdx: number) {
  const ws = get(activeWorkspace);
  if (!ws) return;
  const pane = getAllPanes(ws.paneLayout).find((p) => p.id === paneId);
  if (!pane || fromIdx === toIdx) return;
  const item = pane.surfaces.splice(fromIdx, 1)[0]!;
  const adjustedTo = fromIdx < toIdx ? toIdx - 1 : toIdx;
  pane.surfaces.splice(adjustedTo, 0, item);
  workspaces.update((l) => l);
  schedulePersist();
}

export function focusDirection(dir: "left" | "right" | "up" | "down") {
  const ws = get(activeWorkspace);
  if (!ws) return;
  const allPanes = getAllPanes(ws.paneLayout);
  if (allPanes.length <= 1) return;

  const active = allPanes.find((p) => p.id === ws.activePaneId);

  const focus = (target: Pane) => {
    ws.activePaneId = target.id;
    workspaces.update((l) => l);
    const s = target.surfaces.find((s) => s.id === target.activeSurfaceId);
    void safeFocus(s);
  };

  // Without a measured active element we can't do spatial selection;
  // fall back to DFS order (preserves prior behavior in tests/headless contexts).
  if (!active?.element) {
    const idx = allPanes.findIndex((p) => p.id === ws.activePaneId);
    const nextIdx =
      dir === "right" || dir === "down"
        ? (idx + 1) % allPanes.length
        : (idx - 1 + allPanes.length) % allPanes.length;
    focus(allPanes[nextIdx]!);
    return;
  }

  const aRect = active.element.getBoundingClientRect();
  const EPS = 4; // px tolerance for rects sharing an edge

  const measurable = allPanes.filter((p) => p.element && p.id !== active.id);
  const candidates = measurable.filter((p) => {
    const r = p.element!.getBoundingClientRect();
    switch (dir) {
      case "left":
        return r.right <= aRect.left + EPS;
      case "right":
        return r.left >= aRect.right - EPS;
      case "up":
        return r.bottom <= aRect.top + EPS;
      case "down":
        return r.top >= aRect.bottom - EPS;
    }
  });

  if (candidates.length === 0) {
    // Spatial fallback: DFS wrap-around (original behavior).
    const idx = allPanes.findIndex((p) => p.id === active.id);
    const nextIdx =
      dir === "right" || dir === "down"
        ? (idx + 1) % allPanes.length
        : (idx - 1 + allPanes.length) % allPanes.length;
    focus(allPanes[nextIdx]!);
    return;
  }

  // Among spatial candidates, pick the one whose center on the perpendicular
  // axis is closest to the active pane's center on that axis.
  const aCenterX = (aRect.left + aRect.right) / 2;
  const aCenterY = (aRect.top + aRect.bottom) / 2;
  const isHoriz = dir === "left" || dir === "right";
  const best = candidates.reduce((a, b) => {
    const ra = a.element!.getBoundingClientRect();
    const rb = b.element!.getBoundingClientRect();
    const da = isHoriz
      ? Math.abs((ra.top + ra.bottom) / 2 - aCenterY)
      : Math.abs((ra.left + ra.right) / 2 - aCenterX);
    const db = isHoriz
      ? Math.abs((rb.top + rb.bottom) / 2 - aCenterY)
      : Math.abs((rb.left + rb.right) / 2 - aCenterX);
    return da <= db ? a : b;
  });

  focus(best);
}

/**
 * Resize the active pane's enclosing split by adjusting its `ratio`. The
 * arrow direction picks which divider to move:
 *   - horizontal split: "right" grows ratio (moves divider right), "left" shrinks
 *   - vertical split: "down" grows ratio, "up" shrinks
 *   - mismatched arrow vs split axis: no-op
 *
 * Ratio is clamped to [0.1, 0.9] to keep both children visible. No-op when
 * the active pane has no parent split (single-pane workspace).
 */
export function resizeActivePane(
  dir: "left" | "right" | "up" | "down",
  delta = 0.05,
): void {
  const ws = get(activeWorkspace);
  if (!ws || !ws.activePaneId) return;
  const parentInfo = findParentSplit(ws.paneLayout, ws.activePaneId);
  if (!parentInfo || parentInfo.parent.type !== "split") return;
  const parent = parentInfo.parent;

  const isHorizArrow = dir === "left" || dir === "right";
  const splitIsHoriz = parent.direction === "horizontal";
  if (isHorizArrow !== splitIsHoriz) return;

  const sign = dir === "right" || dir === "down" ? 1 : -1;
  const next = Math.max(0.1, Math.min(0.9, parent.ratio + sign * delta));
  if (next === parent.ratio) return;
  parent.ratio = next;
  workspaces.update((l) => l);
  schedulePersist();
}

export function flashFocusedPane() {
  const pane = get(activePane);
  if (!pane?.element) return;
  const el = pane.element;
  const accent = get(theme).accent;
  el.style.boxShadow = `0 0 0 2px ${accent}, 0 0 16px ${accent}`;
  el.style.transition = "box-shadow 0.3s";
  setTimeout(() => {
    el.style.boxShadow = "";
    setTimeout(() => {
      el.style.transition = "";
    }, 300);
  }, 400);
}

export function splitFromSidebar(direction: "horizontal" | "vertical") {
  const pane = get(activePane);
  if (pane) void splitPane(pane.id, direction);
}

/**
 * Expand a sidebar workspace into the target workspace by splitting each of
 * its surfaces into its own pane next to `targetPaneId`. Surfaces are chained:
 * the first surface splits from targetPane; each subsequent surface splits from
 * the previously-created pane, producing a right-leaning binary split tree.
 *
 * The source workspace is removed without disposing its terminals (they move
 * into tgtWs). Workspace membership and rootRowOrder are cleaned up directly
 * so the worktree handler's "keep or delete?" dialog is NOT triggered — the
 * surfaces are still live.
 */
export function expandWorkspaceIntoPanes(
  srcWorkspaceId: string,
  targetPaneId: string,
  direction: "horizontal" | "vertical",
  before: boolean,
): void {
  const allWs = get(workspaces);
  const srcWs = allWs.find((ws) => ws.id === srcWorkspaceId);
  const tgtWs = allWs.find((ws) =>
    getAllPanes(ws.paneLayout).some((p) => p.id === targetPaneId),
  );
  if (!srcWs || !tgtWs || srcWs === tgtWs) return;

  // Collect all surfaces from source workspace in pane order
  const allSurfaces = getAllSurfaces(srcWs);
  if (allSurfaces.length === 0) return;

  // Chain splits: each new pane becomes the anchor for the next
  let anchorPaneId = targetPaneId;

  for (const surface of allSurfaces) {
    const newPane: Pane = {
      id: uid(),
      surfaces: [surface],
      activeSurfaceId: surface.id,
    };

    const anchorPane = getAllPanes(tgtWs.paneLayout).find(
      (p) => p.id === anchorPaneId,
    );
    if (!anchorPane) continue;

    const newSplit: SplitNode = {
      type: "split",
      direction,
      children: before
        ? [
            { type: "pane", pane: newPane },
            { type: "pane", pane: anchorPane },
          ]
        : [
            { type: "pane", pane: anchorPane },
            { type: "pane", pane: newPane },
          ],
      ratio: 0.5,
    };

    if (
      tgtWs.paneLayout.type === "pane" &&
      tgtWs.paneLayout.pane.id === anchorPaneId
    ) {
      tgtWs.paneLayout = newSplit;
    } else {
      const parentInfo = findParentSplit(tgtWs.paneLayout, anchorPaneId);
      if (parentInfo && parentInfo.parent.type === "split") {
        parentInfo.parent.children[parentInfo.index] = newSplit;
      }
    }

    anchorPaneId = newPane.id;
  }

  tgtWs.activePaneId = anchorPaneId;

  // Remove source workspace without disposing terminals (surfaces already moved).
  // Clean up directly instead of emitting workspace:closed to avoid triggering
  // the worktree handler's interactive "keep or delete?" dialog.
  workspaces.update((list) => list.filter((ws) => ws.id !== srcWorkspaceId));
  {
    const newIdx = Math.min(
      get(activeWorkspaceIdx),
      get(workspaces).length - 1,
    );
    const targetId = get(workspaces)[newIdx]?.id ?? null;
    activeWorkspaceId.set(targetId);
  }
  removeRootRow({ kind: "workspace", id: srcWorkspaceId });
  removeChildFromAllWorkspaces(srcWorkspaceId);
  gitStatusWorkspaceClosed(srcWorkspaceId);
  schedulePersist();
}

/**
 * Collapse all surfaces from a source workspace into a single target pane as
 * tabs. This is the inverse of `expandWorkspaceIntoPanes`: instead of
 * splitting a workspace into many panes, it merges all surfaces from
 * `srcWorkspaceId` into `targetPaneId` in the target workspace.
 *
 * The source workspace is removed without disposing terminals (surfaces move
 * live). Workspace membership and rootRowOrder are cleaned up directly so
 * the worktree handler's "keep or delete?" dialog is NOT triggered.
 */
export function mergeWorkspaceIntoPane(
  srcWorkspaceId: string,
  targetPaneId: string,
): void {
  const allWs = get(workspaces);
  const srcWs = allWs.find((ws) => ws.id === srcWorkspaceId);
  const tgtWs = allWs.find((ws) =>
    getAllPanes(ws.paneLayout).some((p) => p.id === targetPaneId),
  );
  if (!srcWs || !tgtWs || srcWs === tgtWs) return;

  const targetPane = getAllPanes(tgtWs.paneLayout).find(
    (p) => p.id === targetPaneId,
  );
  if (!targetPane) return;

  const allSurfaces = getAllSurfaces(srcWs);
  if (allSurfaces.length === 0) return;

  targetPane.surfaces.push(...allSurfaces);
  const lastSurface = allSurfaces[allSurfaces.length - 1];
  if (lastSurface) {
    targetPane.activeSurfaceId = lastSurface.id;
  }
  tgtWs.activePaneId = targetPane.id;

  workspaces.update((list) => [
    ...list.filter((ws) => ws.id !== srcWorkspaceId),
  ]);
  {
    const newIdx = Math.min(
      get(activeWorkspaceIdx),
      get(workspaces).length - 1,
    );
    const targetId = get(workspaces)[newIdx]?.id ?? null;
    activeWorkspaceId.set(targetId);
  }
  removeRootRow({ kind: "workspace", id: srcWorkspaceId });
  removeChildFromAllWorkspaces(srcWorkspaceId);
  gitStatusWorkspaceClosed(srcWorkspaceId);
  schedulePersist();
}

/**
 * Move a single surface out of its source pane (in any workspace) into
 * the active pane of `targetWorkspaceId`. Backs the sidebar-drop drag
 * gesture: drag a tab onto a different workspace's row to relocate the
 * surface there.
 *
 * - source pane goes empty → it collapses out of the source
 *   workspace's split tree (terminal NOT disposed)
 * - target falls back to the first pane when the workspace has no
 *   `activePaneId` set
 * - schedules a state persist so the move survives a restart
 *
 * Note: unlike `splitPaneWithSurface` this finds the source workspace
 * by walking every workspace for a pane match, since the source might
 * not be the active workspace.
 */
export function moveSurfaceToWorkspace(
  surfaceId: string,
  sourcePaneId: string,
  targetWorkspaceId: string,
): void {
  const allWs = get(workspaces);
  const srcWs = allWs.find((ws) =>
    getAllPanes(ws.paneLayout).some((p) => p.id === sourcePaneId),
  );
  const tgtWs = allWs.find((ws) => ws.id === targetWorkspaceId);
  if (!srcWs || !tgtWs || srcWs === tgtWs) return;

  const sourcePane = getAllPanes(srcWs.paneLayout).find(
    (p) => p.id === sourcePaneId,
  );
  if (!sourcePane) return;
  const idx = sourcePane.surfaces.findIndex((s) => s.id === surfaceId);
  if (idx === -1) return;
  const [surface] = sourcePane.surfaces.splice(idx, 1);
  if (!surface) return;
  if (sourcePane.activeSurfaceId === surfaceId) {
    sourcePane.activeSurfaceId = sourcePane.surfaces[0]?.id ?? null;
  }
  if (
    sourcePane.surfaces.length === 0 &&
    !(
      srcWs.paneLayout.type === "pane" &&
      srcWs.paneLayout.pane.id === sourcePaneId
    )
  ) {
    collapseEmptyPaneInWorkspace(srcWs, sourcePaneId);
  }

  const tgtAllPanes = getAllPanes(tgtWs.paneLayout);
  const targetPane =
    tgtAllPanes.find((p) => p.id === tgtWs.activePaneId) ?? tgtAllPanes[0];
  if (!targetPane) return;
  targetPane.surfaces.push(surface);
  targetPane.activeSurfaceId = surface.id;

  workspaces.update((l) => l);
  schedulePersist();
}
