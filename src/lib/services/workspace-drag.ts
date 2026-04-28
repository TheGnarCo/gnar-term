import { writable, get, type Readable } from "svelte/store";
import { workspaces } from "../stores/workspace";
import { getAllPanes } from "../types";

export type WorkspacePaneDropTarget =
  | {
      kind: "pane-split";
      paneId: string;
      zone: "top" | "bottom" | "left" | "right";
    }
  | { kind: "tab-merge"; paneId: string }
  | { kind: "deny" }
  | null;

export interface WorkspaceDragState {
  workspaceId: string;
  dropTarget: WorkspacePaneDropTarget;
}

const _workspaceDragState = writable<WorkspaceDragState | null>(null);
export const workspaceDragState: Readable<WorkspaceDragState | null> = {
  subscribe: _workspaceDragState.subscribe,
};

export function setWorkspaceDragState(state: WorkspaceDragState | null): void {
  _workspaceDragState.set(state);
}

export function detectWorkspacePaneDrop(
  x: number,
  y: number,
  srcWorkspaceId: string,
): WorkspacePaneDropTarget {
  const allWs = get(workspaces);
  const srcWs = allWs.find((ws) => ws.id === srcWorkspaceId);
  const srcGroupId = (srcWs?.metadata as Record<string, unknown> | undefined)
    ?.groupId as string | undefined;

  const paneBodies = Array.from(
    document.querySelectorAll("[data-pane-body]"),
  ) as HTMLElement[];

  for (const bodyEl of paneBodies) {
    const paneId = bodyEl.getAttribute("data-pane-body");
    if (!paneId) continue;

    const rect = bodyEl.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom)
      continue;

    // Find which workspace owns this pane
    const tgtWs = allWs.find((ws) =>
      getAllPanes(ws.splitRoot).some((p) => p.id === paneId),
    );
    if (!tgtWs || tgtWs.id === srcWorkspaceId) continue;

    const tgtGroupId = (tgtWs.metadata as Record<string, unknown> | undefined)
      ?.groupId as string | undefined;

    // Group compatibility: root → root only; grouped → same group only
    if (srcGroupId !== tgtGroupId) {
      return { kind: "deny" };
    }

    // Compute the directional drop zone, excluding the tab-bar height
    const tabBarEl = bodyEl.querySelector(
      "[data-pane-id]",
    ) as HTMLElement | null;
    const tabBarH = tabBarEl ? tabBarEl.getBoundingClientRect().height : 0;
    const surfaceTop = rect.top + tabBarH;
    const surfaceH = rect.height - tabBarH;
    if (surfaceH <= 0) continue;
    const relX = (x - rect.left) / rect.width;
    const relY = (y - surfaceTop) / surfaceH;
    const zone: "top" | "bottom" | "left" | "right" =
      Math.abs(relX - 0.5) > Math.abs(relY - 0.5)
        ? relX < 0.5
          ? "left"
          : "right"
        : relY < 0.5
          ? "top"
          : "bottom";

    return { kind: "pane-split", paneId, zone };
  }

  return null;
}

export function detectTabBarDropForWorkspace(
  x: number,
  y: number,
  srcWorkspaceId: string,
): WorkspacePaneDropTarget {
  const allWs = get(workspaces);
  const srcWs = allWs.find((ws) => ws.id === srcWorkspaceId);
  const srcGroupId = (srcWs?.metadata as Record<string, unknown> | undefined)
    ?.groupId as string | undefined;

  const elAtCursor = document.elementFromPoint(x, y);
  if (!elAtCursor) return null;

  const tabBarEl = (elAtCursor as Element).closest(
    "[data-pane-id]",
  ) as HTMLElement | null;
  if (!tabBarEl) return null;

  const paneId = tabBarEl.getAttribute("data-pane-id");
  if (!paneId) return null;

  const tgtWs = allWs.find((ws) =>
    getAllPanes(ws.splitRoot).some((p) => p.id === paneId),
  );
  if (!tgtWs || tgtWs.id === srcWorkspaceId) return null;

  const tgtGroupId = (tgtWs.metadata as Record<string, unknown> | undefined)
    ?.groupId as string | undefined;
  if (srcGroupId !== tgtGroupId) {
    return { kind: "deny" };
  }

  return { kind: "tab-merge", paneId };
}
