/**
 * Tab drag-and-drop state machine.
 *
 * Tauri's WKWebView implements HTML5 DnD unreliably — drags can stall
 * mid-flight or never fire `dragend` on the renderer side. The sidebar
 * already replaced HTML5 DnD with a mouse-event state machine
 * (`drag-reorder.ts`); this module mirrors that pattern for tab drags.
 *
 * The state machine activates after the cursor moves >5px from the
 * mousedown origin, then publishes a live `tabDragState` describing the
 * current drop target. On mouseup the resolved drop target dispatches
 * to the right service call (within-pane reorder for now; cross-pane
 * split and sidebar moves added in later stories).
 */
import { writable, get, type Readable } from "svelte/store";
import { workspaces } from "../stores/workspace";
import { getAllPanes, getAllSurfaces } from "../types";
import { reorderTab, splitPaneWithSurface } from "./pane-service";

export type TabDropTarget =
  | { kind: "reorder"; paneId: string; insertIdx: number }
  | { kind: "split"; paneId: string }
  | { kind: "move-to-workspace"; workspaceId: string }
  | { kind: "new-workspace" }
  | null;

export interface TabDragState {
  surfaceId: string;
  sourcePaneId: string;
  sourceWorkspaceId: string;
  position: { x: number; y: number };
  dropTarget: TabDropTarget;
}

const _tabDragState = writable<TabDragState | null>(null);
export const tabDragState: Readable<TabDragState | null> = {
  subscribe: _tabDragState.subscribe,
};

let ghost: HTMLElement | null = null;

export function startTabDrag(
  e: MouseEvent,
  surfaceId: string,
  paneId: string,
  workspaceId: string,
): void {
  if (e.button !== 0) return;
  e.preventDefault();

  const startX = e.clientX;
  const startY = e.clientY;
  const sourceEl = e.currentTarget as HTMLElement | null;
  let activated = false;

  function onMove(ev: MouseEvent): void {
    if (!activated) {
      if (
        Math.abs(ev.clientX - startX) < 5 &&
        Math.abs(ev.clientY - startY) < 5
      )
        return;
      activated = true;
      if (sourceEl) {
        ghost = sourceEl.cloneNode(true) as HTMLElement;
        ghost.style.cssText = `
          position: fixed; pointer-events: none; z-index: 9999; opacity: 0.8;
          width: ${sourceEl.offsetWidth}px;
          left: ${ev.clientX + 8}px; top: ${ev.clientY - 12}px;
        `;
        document.body.appendChild(ghost);
      }
      _tabDragState.set({
        surfaceId,
        sourcePaneId: paneId,
        sourceWorkspaceId: workspaceId,
        position: { x: ev.clientX, y: ev.clientY },
        dropTarget: detectDropTarget(
          ev.clientX,
          ev.clientY,
          paneId,
          workspaceId,
        ),
      });
    } else {
      if (ghost) {
        ghost.style.left = `${ev.clientX + 8}px`;
        ghost.style.top = `${ev.clientY - 12}px`;
      }
      _tabDragState.update((s) =>
        s
          ? {
              ...s,
              position: { x: ev.clientX, y: ev.clientY },
              dropTarget: detectDropTarget(
                ev.clientX,
                ev.clientY,
                paneId,
                workspaceId,
              ),
            }
          : s,
      );
    }
  }

  function onUp(): void {
    cleanup();
    commitTabDrop();
  }

  function onKey(ev: KeyboardEvent): void {
    if (ev.key === "Escape") {
      cleanup();
      cancelTabDrag();
    }
  }

  function cleanup(): void {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    window.removeEventListener("keydown", onKey);
    if (ghost) {
      ghost.remove();
      ghost = null;
    }
  }

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  window.addEventListener("keydown", onKey);
}

function detectDropTarget(
  x: number,
  y: number,
  sourcePaneId: string,
  sourceWorkspaceId: string,
): TabDropTarget {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;

  // Tab bar (within-pane reorder or cross-pane split).
  const tabBar = el.closest("[data-pane-id]") as HTMLElement | null;
  if (tabBar) {
    const paneId = tabBar.getAttribute("data-pane-id");
    if (!paneId) return null;
    if (paneId === sourcePaneId) {
      const tabs = Array.from(
        tabBar.querySelectorAll("[data-tab-idx]"),
      ) as HTMLElement[];
      let insertIdx = tabs.length;
      for (const tab of tabs) {
        const rect = tab.getBoundingClientRect();
        if (x < rect.left + rect.width / 2) {
          insertIdx = parseInt(tab.getAttribute("data-tab-idx") || "0", 10);
          break;
        }
      }
      return { kind: "reorder", paneId, insertIdx };
    }
    return { kind: "split", paneId };
  }

  // Sidebar workspace row — move to that workspace (same group only).
  const wsItem = el.closest("[data-workspace-id]") as HTMLElement | null;
  if (wsItem) {
    const wsId = wsItem.getAttribute("data-workspace-id");
    if (!wsId || wsId === sourceWorkspaceId) return null;
    const allWs = get(workspaces);
    const srcWs = allWs.find((w) => w.id === sourceWorkspaceId);
    const tgtWs = allWs.find((w) => w.id === wsId);
    if (!srcWs || !tgtWs) return null;
    const srcGroupId = (srcWs.metadata as Record<string, unknown> | undefined)
      ?.groupId;
    const tgtGroupId = (tgtWs.metadata as Record<string, unknown> | undefined)
      ?.groupId;
    if (srcGroupId !== tgtGroupId) return null;
    return { kind: "move-to-workspace", workspaceId: wsId };
  }

  // Empty primary-sidebar area — drop to spawn a new workspace.
  // Guarded: source must have >1 surface so we don't leave it empty.
  const sidebar = el.closest("#primary-sidebar");
  if (sidebar) {
    const allWs = get(workspaces);
    const srcWs = allWs.find((w) => w.id === sourceWorkspaceId);
    if (srcWs && getAllSurfaces(srcWs).length > 1) {
      return { kind: "new-workspace" };
    }
    return null;
  }

  return null;
}

export function commitTabDrop(): void {
  const state = get(_tabDragState);
  _tabDragState.set(null);
  if (!state || !state.dropTarget) return;

  const { surfaceId, sourcePaneId, sourceWorkspaceId, dropTarget } = state;

  switch (dropTarget.kind) {
    case "reorder": {
      const allWs = get(workspaces);
      const srcWs = allWs.find((w) => w.id === sourceWorkspaceId);
      if (!srcWs) return;
      const pane = getAllPanes(srcWs.splitRoot).find(
        (p) => p.id === dropTarget.paneId,
      );
      if (!pane) return;
      const fromIdx = pane.surfaces.findIndex((s) => s.id === surfaceId);
      if (fromIdx === -1) return;
      // reorderTab interprets toIdx as the "insert before original index"
      // value and handles the splice adjustment internally — pass
      // insertIdx straight through, no pre-adjustment.
      reorderTab(dropTarget.paneId, fromIdx, dropTarget.insertIdx);
      break;
    }
    case "split": {
      splitPaneWithSurface(surfaceId, sourcePaneId, dropTarget.paneId);
      break;
    }
    // Story 3 dispatches (move-to-workspace, new-workspace) added when
    // those services land.
    default:
      // Unknown / not-yet-handled drop kinds are silent no-ops.
      break;
  }
}

export function cancelTabDrag(): void {
  _tabDragState.set(null);
}

/**
 * Test-only seam — sets the internal drag state directly so tests can
 * exercise commitTabDrop's branches without simulating a full drag.
 * Not exported to non-test consumers.
 */
export function __setTabDropTargetForTest(state: TabDragState | null): void {
  _tabDragState.set(state);
}
