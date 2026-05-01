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
import { nestedWorkspaces } from "../stores/nested-workspace";
import { theme } from "../stores/theme";
import { getAllPanes, getAllSurfaces } from "../types";
import {
  reorderTab,
  mergeTabToPane,
  splitPaneWithSurface,
} from "./pane-service";
import { createNestedWorkspaceFromSurface } from "./nested-workspace-service";
import { getWorkspaces } from "../stores/workspaces";
import { rootRowOrder } from "../stores/root-row-order";

export type TabDropTarget =
  | { kind: "reorder"; paneId: string; insertIdx: number }
  | { kind: "merge"; paneId: string }
  | {
      kind: "surface-split";
      paneId: string;
      zone: "top" | "bottom" | "left" | "right";
    }
  | { kind: "new-workspace"; insertIdx: number; insertEdge: "before" | "after" }
  | {
      kind: "new-workspace-in-group";
      parentWorkspaceId: string;
      insertGlobalIdx: number;
      insertEdge: "before" | "after";
    }
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
let lastHoveredTabId: string | null = null;
let activeCleanup: (() => void) | null = null;

function activateHoveredTab(x: number, y: number, sourcePaneId: string): void {
  const el = document.elementFromPoint(x, y);
  if (!el) {
    lastHoveredTabId = null;
    return;
  }
  const tabEl = (el as Element).closest(
    "[data-tab-surface-id]",
  ) as HTMLElement | null;
  if (!tabEl) {
    lastHoveredTabId = null;
    return;
  }
  const tabBarEl = tabEl.closest("[data-pane-id]") as HTMLElement | null;
  if (!tabBarEl) {
    lastHoveredTabId = null;
    return;
  }
  const paneId = tabBarEl.getAttribute("data-pane-id");
  const surfaceId = tabEl.getAttribute("data-tab-surface-id");
  if (!paneId || !surfaceId || paneId === sourcePaneId) {
    lastHoveredTabId = null;
    return;
  }
  if (surfaceId === lastHoveredTabId) return;
  lastHoveredTabId = surfaceId;
  nestedWorkspaces.update((wsList) =>
    wsList.map((ws) => {
      const pane = getAllPanes(ws.splitRoot).find((p) => p.id === paneId);
      if (!pane || !pane.surfaces.find((s) => s.id === surfaceId)) return ws;
      pane.activeSurfaceId = surfaceId;
      return { ...ws };
    }),
  );
}

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
        const t = get(theme);
        ghost = sourceEl.cloneNode(true) as HTMLElement;
        Object.assign(ghost.style, {
          position: "fixed",
          pointerEvents: "none",
          zIndex: "9999",
          opacity: "0.9",
          width: `${sourceEl.offsetWidth}px`,
          left: `${ev.clientX + 8}px`,
          top: `${ev.clientY - 12}px`,
          background: t.bgActive,
          color: t.fg,
          borderBottom: `2px solid ${t.accent}`,
          borderRadius: "4px 4px 0 0",
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          cursor: "grabbing",
        });
        document.body.appendChild(ghost);
      }
      activateHoveredTab(ev.clientX, ev.clientY, paneId);
      const newDrop = detectDropTarget(
        ev.clientX,
        ev.clientY,
        paneId,
        workspaceId,
      );
      _tabDragState.set({
        surfaceId,
        sourcePaneId: paneId,
        sourceWorkspaceId: workspaceId,
        position: { x: ev.clientX, y: ev.clientY },
        dropTarget: newDrop,
      });
    } else {
      if (ghost) {
        ghost.style.left = `${ev.clientX + 8}px`;
        ghost.style.top = `${ev.clientY - 12}px`;
      }
      activateHoveredTab(ev.clientX, ev.clientY, paneId);
      const newDrop = detectDropTarget(
        ev.clientX,
        ev.clientY,
        paneId,
        workspaceId,
      );
      _tabDragState.update((s) =>
        s
          ? {
              ...s,
              position: { x: ev.clientX, y: ev.clientY },
              dropTarget: newDrop,
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

  activeCleanup = cleanup;
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

  // el-dependent checks (tab bar, sidebar, workspace row).
  if (el) {
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
      return { kind: "merge", paneId };
    }

    // Group workspace row (nested inside a container — must check BEFORE
    // root-row because nested rows sit inside root-row wrappers in the DOM).
    const wsViewRowEl = el.closest(
      "[data-ws-view-drag-idx]",
    ) as HTMLElement | null;
    if (wsViewRowEl) {
      const containerEl = wsViewRowEl.closest(
        "[data-container-nested]",
      ) as HTMLElement | null;
      const parentWorkspaceId =
        containerEl?.getAttribute("data-container-nested") ?? null;
      if (parentWorkspaceId) {
        const srcWs = get(nestedWorkspaces).find(
          (w) => w.id === sourceWorkspaceId,
        );
        const srcWorkspaceId = srcWs?.metadata?.parentWorkspaceId;
        if (srcWorkspaceId !== parentWorkspaceId) {
          if (srcWorkspaceId) return null; // grouped tab over different group → deny
          // Root tab over a group's nested workspace → create a nested workspace
          // in that group rather than falling through to root-row detection.
          if (srcWs && getAllSurfaces(srcWs).length > 1) {
            const globalIdx = parseInt(
              wsViewRowEl.getAttribute("data-ws-view-drag-idx") || "0",
              10,
            );
            const rect = wsViewRowEl.getBoundingClientRect();
            const insertEdge: "before" | "after" =
              y < rect.top + rect.height / 2 ? "before" : "after";
            return {
              kind: "new-workspace-in-group",
              parentWorkspaceId,
              insertGlobalIdx: globalIdx,
              insertEdge,
            };
          }
          return null;
        } else {
          // Same group — offer a positional insert.
          if (srcWs && getAllSurfaces(srcWs).length > 1) {
            const globalIdx = parseInt(
              wsViewRowEl.getAttribute("data-ws-view-drag-idx") || "0",
              10,
            );
            const rect = wsViewRowEl.getBoundingClientRect();
            const insertEdge: "before" | "after" =
              y < rect.top + rect.height / 2 ? "before" : "after";
            return {
              kind: "new-workspace-in-group",
              parentWorkspaceId,
              insertGlobalIdx: globalIdx,
              insertEdge,
            };
          }
          return null;
        }
      }
    }

    // Root row (workspace or container block).
    // Direct hit on the inner content div — works for most cursor positions.
    let rootRowEl = el.closest("[data-root-row-idx]") as HTMLElement | null;
    // Fallback: cursor may land on a DropGhost rendered inside the row's
    // outer container div (.root-row[data-root-row-container]).  The DropGhost
    // is a sibling of the [data-root-row-idx] inner div, so closest() from the
    // DropGhost never reaches [data-root-row-idx].  The container attribute
    // exposes the correct row index and lets us find the inner div for an
    // accurate bounding-rect edge calculation.
    if (!rootRowEl) {
      const containerEl = (el as Element).closest(
        "[data-root-row-container]",
      ) as HTMLElement | null;
      if (containerEl) {
        rootRowEl = containerEl.querySelector(
          "[data-root-row-idx]",
        ) as HTMLElement | null;
      }
    }
    if (rootRowEl) {
      const srcWs = get(nestedWorkspaces).find(
        (w) => w.id === sourceWorkspaceId,
      );
      const srcWorkspaceId = srcWs?.metadata?.parentWorkspaceId;
      if (srcWorkspaceId) return null;
      const rowIdx = parseInt(
        rootRowEl.getAttribute("data-root-row-idx") || "0",
        10,
      );
      const rect = rootRowEl.getBoundingClientRect();
      const insertEdge: "before" | "after" =
        y < rect.top + rect.height / 2 ? "before" : "after";
      if (srcWs && getAllSurfaces(srcWs).length > 1) {
        return { kind: "new-workspace", insertIdx: rowIdx, insertEdge };
      }
      return null;
    }

    // Empty primary-sidebar area — drop to spawn a new workspace appended
    // at the end of the root row order.
    const sidebar = el.closest("#primary-sidebar");
    if (sidebar) {
      const srcWs = get(nestedWorkspaces).find(
        (w) => w.id === sourceWorkspaceId,
      );
      const srcWorkspaceId = srcWs?.metadata?.parentWorkspaceId;
      if (srcWorkspaceId) return null;
      if (srcWs && getAllSurfaces(srcWs).length > 1) {
        const order = get(rootRowOrder);
        const lastIdx = Math.max(0, order.length - 1);
        return {
          kind: "new-workspace",
          insertIdx: lastIdx,
          insertEdge: "after",
        };
      }
      return null;
    }
  }

  // Pane surface body — directional split hint.
  // Use a bounding-rect scan instead of closest() so the xterm canvas
  // (which sits at the top of the z-stack) doesn't block detection.
  const paneBodies = Array.from(
    document.querySelectorAll("[data-pane-body]"),
  ) as HTMLElement[];
  for (const bodyEl of paneBodies) {
    const paneId = bodyEl.getAttribute("data-pane-body");
    if (!paneId) continue;
    if (paneId === sourcePaneId) {
      // Allow same-pane surface-split only when there are ≥2 surfaces to split from.
      const allWs = get(nestedWorkspaces);
      const srcWs = allWs.find((w) => w.id === sourceWorkspaceId);
      const srcPane =
        srcWs &&
        getAllPanes(srcWs.splitRoot).find((p) => p.id === sourcePaneId);
      if (!srcPane || srcPane.surfaces.length <= 1) continue;
    }
    const rect = bodyEl.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom)
      continue;
    const tabBarEl = bodyEl.querySelector(
      "[data-pane-id]",
    ) as HTMLElement | null;
    const tabBarH = tabBarEl ? tabBarEl.getBoundingClientRect().height : 0;
    const surfaceTop = rect.top + tabBarH;
    const surfaceH = rect.height - tabBarH;
    if (surfaceH <= 0) continue;
    const relX = (x - rect.left) / rect.width;
    const relY = (y - surfaceTop) / surfaceH;
    const zone =
      Math.abs(relX - 0.5) > Math.abs(relY - 0.5)
        ? relX < 0.5
          ? "left"
          : "right"
        : relY < 0.5
          ? "top"
          : "bottom";
    return { kind: "surface-split", paneId, zone };
  }

  return null;
}

export function commitTabDrop(): void {
  const state = get(_tabDragState);
  _tabDragState.set(null);
  lastHoveredTabId = null;
  if (!state || !state.dropTarget) return;

  const { surfaceId, sourcePaneId, sourceWorkspaceId, dropTarget } = state;

  switch (dropTarget.kind) {
    case "reorder": {
      const allWs = get(nestedWorkspaces);
      const srcWs = allWs.find((w) => w.id === sourceWorkspaceId);
      if (!srcWs) return;
      const pane = getAllPanes(srcWs.splitRoot).find(
        (p) => p.id === dropTarget.paneId,
      );
      if (!pane) return;
      const fromIdx = pane.surfaces.findIndex((s) => s.id === surfaceId);
      if (fromIdx === -1) return;
      reorderTab(dropTarget.paneId, fromIdx, dropTarget.insertIdx);
      break;
    }
    case "merge": {
      mergeTabToPane(surfaceId, sourcePaneId, dropTarget.paneId);
      break;
    }
    case "surface-split": {
      const direction =
        dropTarget.zone === "left" || dropTarget.zone === "right"
          ? "horizontal"
          : "vertical";
      const before = dropTarget.zone === "left" || dropTarget.zone === "top";
      splitPaneWithSurface(
        surfaceId,
        sourcePaneId,
        dropTarget.paneId,
        direction,
        before,
      );
      break;
    }
    case "new-workspace": {
      const insertAt =
        dropTarget.insertEdge === "before"
          ? dropTarget.insertIdx
          : dropTarget.insertIdx + 1;
      createNestedWorkspaceFromSurface(
        surfaceId,
        sourcePaneId,
        sourceWorkspaceId,
        {
          kind: "root",
          insertIdx: insertAt,
        },
      );
      break;
    }
    case "new-workspace-in-group": {
      const allWs = get(nestedWorkspaces);
      const tgtWs = allWs[dropTarget.insertGlobalIdx];
      if (!tgtWs) break;
      const group = getWorkspaces().find(
        (g) => g.id === dropTarget.parentWorkspaceId,
      );
      if (!group) break;
      const posInWorkspace = group.nestedWorkspaceIds.indexOf(tgtWs.id);
      const insertPos =
        dropTarget.insertEdge === "before"
          ? Math.max(0, posInWorkspace)
          : posInWorkspace === -1
            ? group.nestedWorkspaceIds.length
            : posInWorkspace + 1;
      createNestedWorkspaceFromSurface(
        surfaceId,
        sourcePaneId,
        sourceWorkspaceId,
        {
          kind: "group",
          positionInWorkspace: insertPos,
          targetWorkspaceId: dropTarget.parentWorkspaceId,
        },
      );
      break;
    }
    default:
      // Unknown / not-yet-handled drop kinds are silent no-ops.
      break;
  }
}

export function cancelTabDrag(): void {
  lastHoveredTabId = null;
  activeCleanup?.();
  activeCleanup = null;
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
