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
import { theme } from "../stores/theme";
import { createTerminalSurface } from "../terminal-service";
import {
  uid,
  getAllPanes,
  isTerminalSurface,
  findParentSplit,
  findPaneInWorkspace,
  replaceNodeInTree,
  type Workspace,
  type Pane,
  type SplitNode,
} from "../types";
import {
  createWorkspace,
  promoteMemberToAnchor,
  removeMemberFromAllGroups,
} from "./workspace-service";
import { removeWorkspaceRow } from "../stores/workspace-order";
import { isAnchorWorkspace, isWorkspaceMember } from "../types";
import { schedulePersist } from "./workspace-persist";
import { safeFocus, getCwdForSurface } from "./service-helpers";

export async function splitPane(
  paneId: string,
  direction: "horizontal" | "vertical",
) {
  const ws = get(activeWorkspace);
  if (!ws) return;
  const activeP = findPaneInWorkspace(ws, paneId) ?? get(activePane);
  if (!activeP) return;

  const sourceSurface = activeP.surfaces.find(
    (s) => s.id === activeP.activeSurfaceId,
  );
  const newPane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
  const cwd = await getCwdForSurface(sourceSurface);
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
  workspaces.update((l) => [...l]);
  safeFocus(surface);
}

export function removePane(ws: Workspace, pane: Pane) {
  pane.resizeObserver?.disconnect();
  if (ws.splitRoot.type === "pane" && ws.splitRoot.pane.id === pane.id) {
    const wsList = get(workspaces);
    const wsIdx = wsList.indexOf(ws);
    const closingId = ws.id;
    const wasMember = isWorkspaceMember(ws);
    // Promote-first-member back-edge: if this workspace is an anchor that
    // still owns members, the first member becomes the new anchor and keeps
    // the group's sidebar position. Run BEFORE removing the workspace so the
    // promoted member's tag/order swap sees the closed anchor still present.
    let promotedId: string | null = null;
    if (isAnchorWorkspace(ws)) {
      promotedId = promoteMemberToAnchor(closingId);
    }
    workspaces.update((list) => list.filter((w) => w.id !== closingId));
    // The closed anchor's row was either replaced by the promoted member's
    // row (inside promoteMemberToAnchor) or — for a memberless anchor — must
    // be dropped here. Members never owned a row; detach from their group.
    if (promotedId === null) {
      removeWorkspaceRow({ kind: "workspace", id: closingId });
    }
    if (wasMember) removeMemberFromAllGroups(closingId);
    if (get(workspaces).length === 0) {
      // Very-last-workspace back-edge — spawn a fresh standalone.
      createWorkspace("Workspace 1");
    } else {
      activeWorkspaceIdx.set(Math.min(wsIdx, get(workspaces).length - 1));
    }
    schedulePersist();
    return;
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
  workspaces.update((l) => [...l]);
  safeFocus(get(activeSurface));
}

export function closePane(paneId: string) {
  const ws = get(activeWorkspace);
  if (!ws) return;
  const pane = findPaneInWorkspace(ws, paneId);
  if (!pane) return;
  for (const s of [...pane.surfaces]) {
    if (isTerminalSurface(s)) {
      s.terminal.dispose();
      if (s.ptyId >= 0) invoke("kill_pty", { ptyId: s.ptyId }).catch(() => {});
    }
  }
  pane.surfaces = [];
  removePane(ws, pane);
}

export function focusPane(paneId: string) {
  const ws = get(activeWorkspace);
  if (!ws || ws.activePaneId === paneId) return;
  ws.activePaneId = paneId;
  workspaces.update((l) => [...l]);
}

export function reorderTab(paneId: string, fromIdx: number, toIdx: number) {
  const ws = get(activeWorkspace);
  if (!ws) return;
  const pane = findPaneInWorkspace(ws, paneId);
  if (!pane || fromIdx === toIdx) return;
  const item = pane.surfaces.splice(fromIdx, 1)[0];
  const adjustedTo = fromIdx < toIdx ? toIdx - 1 : toIdx;
  pane.surfaces.splice(adjustedTo, 0, item);
  workspaces.update((l) => [...l]);
}

export function focusDirection(dir: "left" | "right" | "up" | "down") {
  const ws = get(activeWorkspace);
  if (!ws) return;
  const panes = getAllPanes(ws.splitRoot);
  if (panes.length <= 1) return;
  const currentIdx = panes.findIndex((p) => p.id === ws.activePaneId);
  const nextIdx =
    dir === "right" || dir === "down"
      ? (currentIdx + 1) % panes.length
      : (currentIdx - 1 + panes.length) % panes.length;
  ws.activePaneId = panes[nextIdx].id;
  workspaces.update((l) => [...l]);
  const s = panes[nextIdx].surfaces.find(
    (s) => s.id === panes[nextIdx].activeSurfaceId,
  );
  safeFocus(s);
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
  if (pane) splitPane(pane.id, direction);
}

/**
 * Toggle the maximized ("zoomed") state of the surface. When a surface is
 * zoomed its pane fills the workspace, hiding sibling panes; toggling again
 * (or zooming a different surface) restores the split layout.
 */
export function togglePaneZoom(surfaceId: string) {
  zoomedSurfaceId.update((current) =>
    current === surfaceId ? null : surfaceId,
  );
}

/**
 * Collapse a now-empty source pane out of the workspace tree by replacing its
 * parent split with the sibling subtree. The caller has already moved the
 * surface out, so — unlike closePane — no PTY is killed here. No-op when the
 * source pane is the workspace root (there is nothing to collapse into).
 */
function collapseEmptyPane(ws: Workspace, sourcePaneId: string) {
  if (ws.splitRoot.type === "pane" && ws.splitRoot.pane.id === sourcePaneId)
    return;
  const parentInfo = findParentSplit(ws.splitRoot, sourcePaneId);
  if (parentInfo && parentInfo.parent.type === "split") {
    const sibling = parentInfo.parent.children[parentInfo.index === 0 ? 1 : 0];
    if (ws.splitRoot === parentInfo.parent) {
      ws.splitRoot = sibling;
    } else {
      replaceNodeInTree(ws.splitRoot, parentInfo.parent, sibling);
    }
  }
}

/**
 * Drag a tab onto another pane's body: split the target pane, placing the
 * dragged surface in a fresh pane beside it. `direction`/`before` encode which
 * edge of the target the tab was dropped against (top/left → before). Backs the
 * directional split-zone drop in tab drag-and-drop.
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
  const allPanes = getAllPanes(ws.splitRoot);
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

  if (ws.splitRoot.type === "pane" && ws.splitRoot.pane.id === targetPaneId) {
    ws.splitRoot = newSplit;
  } else {
    const parentInfo = findParentSplit(ws.splitRoot, targetPaneId);
    if (parentInfo && parentInfo.parent.type === "split") {
      parentInfo.parent.children[parentInfo.index] = newSplit;
    }
  }

  // Collapse the source pane if the move emptied it. The new split (target +
  // dragged surface) was just spliced in above, so when target was the root
  // the source can only be nested — safe to collapse.
  if (sourcePane.surfaces.length === 0) {
    collapseEmptyPane(ws, sourcePaneId);
  }

  ws.activePaneId = newPane.id;
  workspaces.update((l) => [...l]);
  safeFocus(surface);
}

/**
 * Drag a tab onto another pane's tab bar: move the surface into that pane's tab
 * list. The source pane collapses if the move empties it. No PTY is killed —
 * the surface is relocated, not closed.
 */
export function mergeTabToPane(
  surfaceId: string,
  sourcePaneId: string,
  targetPaneId: string,
): void {
  if (sourcePaneId === targetPaneId) return;
  const ws = get(activeWorkspace);
  if (!ws) return;
  const allPanes = getAllPanes(ws.splitRoot);
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
  if (sourcePane.surfaces.length === 0) {
    collapseEmptyPane(ws, sourcePaneId);
  }

  targetPane.surfaces.push(surface);
  targetPane.activeSurfaceId = surface.id;
  ws.activePaneId = targetPane.id;
  workspaces.update((l) => [...l]);
  safeFocus(surface);
}
