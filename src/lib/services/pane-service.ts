import { get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import {
  workspaces,
  activeWorkspaceIdx,
  activeWorkspace,
  activePane,
  activeSurface,
} from "../stores/workspace";
import { theme } from "../stores/theme";
import { createTerminalSurface } from "../terminal-service";
import {
  uid,
  getAllPanes,
  isTerminalSurface,
  findParentSplit,
  replaceNodeInTree,
  type Workspace,
  type Pane,
  type SplitNode,
} from "../types";
import { createWorkspace, schedulePersist } from "./workspace-service";
import { safeFocus, getCwdForSurface } from "./service-helpers";
import { eventBus } from "./event-bus";

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
    getAllPanes(ws.splitRoot).find((p) => p.id === paneId) ?? get(activePane);
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
    (getAllPanes(ws.splitRoot).find((p) => p.id === paneId) ?? get(activePane));
  const sourceSurface = sourcePane
    ? sourcePane.surfaces.find((s) => s.id === sourcePane.activeSurfaceId)
    : null;
  const result = splitPaneEmpty(paneId, direction);
  if (!result) return;
  const cwd = await getCwdForSurface(sourceSurface);
  const surface = await createTerminalSurface(result.newPane, cwd);
  workspaces.update((l) => [...l]);
  void safeFocus(surface);
  schedulePersist();
}

export function removePane(ws: Workspace, pane: Pane) {
  const paneId = pane.id;
  const wsId = ws.id;
  pane.resizeObserver?.disconnect();
  if (ws.splitRoot.type === "pane" && ws.splitRoot.pane.id === pane.id) {
    const wsList = get(workspaces);
    const wsIdx = wsList.indexOf(ws);
    workspaces.update((list) => list.filter((w) => w.id !== ws.id));
    eventBus.emit({ type: "pane:closed", id: paneId, workspaceId: wsId });
    if (get(workspaces).length === 0) {
      void createWorkspace("Workspace 1");
    } else {
      activeWorkspaceIdx.set(Math.min(wsIdx, get(workspaces).length - 1));
    }
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
  eventBus.emit({ type: "pane:closed", id: paneId, workspaceId: wsId });
  void safeFocus(get(activeSurface));
}

export function closePane(paneId: string) {
  const ws = get(activeWorkspace);
  if (!ws) return;
  const pane = getAllPanes(ws.splitRoot).find((p) => p.id === paneId);
  if (!pane) return;
  for (const s of [...pane.surfaces]) {
    if (isTerminalSurface(s)) {
      s.terminal.dispose();
      // PTY may already have exited — safe to ignore
      if (s.ptyId >= 0) invoke("kill_pty", { ptyId: s.ptyId }).catch(() => {});
    }
  }
  pane.surfaces = [];
  removePane(ws, pane);
  schedulePersist();
}

export function focusPane(paneId: string) {
  const ws = get(activeWorkspace);
  if (!ws || ws.activePaneId === paneId) return;
  const previousId = ws.activePaneId;
  ws.activePaneId = paneId;
  workspaces.update((l) => [...l]);
  eventBus.emit({ type: "pane:focused", id: paneId, previousId });
}

export function reorderTab(paneId: string, fromIdx: number, toIdx: number) {
  const ws = get(activeWorkspace);
  if (!ws) return;
  const pane = getAllPanes(ws.splitRoot).find((p) => p.id === paneId);
  if (!pane || fromIdx === toIdx) return;
  const item = pane.surfaces.splice(fromIdx, 1)[0]!;
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
  const nextPane = panes[nextIdx]!;
  ws.activePaneId = nextPane.id;
  workspaces.update((l) => [...l]);
  const s = nextPane.surfaces.find((s) => s.id === nextPane.activeSurfaceId);
  void safeFocus(s);
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
