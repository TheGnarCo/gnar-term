import { get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import {
  workspaces,
  activeWorkspace,
  activePane,
  activeSurface,
} from "../stores/workspace";
import { createTerminalSurface } from "../terminal-service";
import {
  getAllPanes,
  isTerminalSurface,
  isExtensionSurface,
  type Workspace,
  type Pane,
} from "../types";
import { openPreview } from "../../preview/index";
import { removePane } from "./pane-service";
import { schedulePersist } from "./workspace-service";
import { safeFocus, getActiveCwd } from "./service-helpers";
import { eventBus } from "./event-bus";

export function selectSurface(paneId: string, surfaceId: string) {
  const ws = get(activeWorkspace);
  if (!ws) return;
  const pane = getAllPanes(ws.splitRoot).find((p) => p.id === paneId);
  if (!pane) return;
  pane.activeSurfaceId = surfaceId;
  const s = pane.surfaces.find((s) => s.id === surfaceId);
  if (s) s.hasUnread = false;
  workspaces.update((l) => [...l]);
  eventBus.emit({ type: "surface:activated", id: surfaceId, paneId });
  safeFocus(s);
}

/**
 * Close all extension surfaces matching the given surface type IDs across all
 * workspaces. Used during extension deactivation to prevent orphaned surfaces.
 */
export function closeExtensionSurfaces(surfaceTypeIds: string[]): void {
  if (surfaceTypeIds.length === 0) return;
  const typeSet = new Set(surfaceTypeIds);
  const wsList = get(workspaces);

  for (const ws of wsList) {
    const panes = getAllPanes(ws.splitRoot);
    for (const pane of panes) {
      // Collect indices in reverse order to preserve splice correctness
      for (let i = pane.surfaces.length - 1; i >= 0; i--) {
        const s = pane.surfaces[i];
        if (isExtensionSurface(s) && typeSet.has(s.surfaceTypeId)) {
          removeSurface(ws, pane, i);
        }
      }
    }
  }
}

export function closeSurfaceById(paneId: string, surfaceId: string) {
  const ws = get(activeWorkspace);
  if (!ws) return;
  const pane = getAllPanes(ws.splitRoot).find((p) => p.id === paneId);
  if (!pane) return;
  const idx = pane.surfaces.findIndex((s) => s.id === surfaceId);
  if (idx < 0) return;
  removeSurface(ws, pane, idx);
}

function removeSurface(ws: Workspace, pane: Pane, surfaceIdx: number) {
  const surface = pane.surfaces[surfaceIdx];
  const surfaceId = surface.id;
  const paneId = pane.id;
  if (isTerminalSurface(surface)) {
    surface.terminal.dispose();
    if (surface.ptyId >= 0) {
      invoke("kill_pty", { ptyId: surface.ptyId }).catch(() => {});
    }
  }
  pane.surfaces.splice(surfaceIdx, 1);
  eventBus.emit({ type: "surface:closed", id: surfaceId, paneId });

  if (pane.surfaces.length === 0) {
    removePane(ws, pane);
  } else {
    pane.activeSurfaceId =
      pane.surfaces[Math.min(surfaceIdx, pane.surfaces.length - 1)].id;
    workspaces.update((l) => [...l]);
    const s = pane.surfaces.find((s) => s.id === pane.activeSurfaceId);
    safeFocus(s);
  }
  schedulePersist();
}

export async function newSurface(paneId: string) {
  const ws = get(activeWorkspace);
  if (!ws) return;
  const pane = getAllPanes(ws.splitRoot).find((p) => p.id === paneId);
  if (!pane) return;
  const cwd = await getActiveCwd();
  const surface = await createTerminalSurface(pane, cwd);
  workspaces.update((l) => [...l]);
  eventBus.emit({
    type: "surface:created",
    id: surface.id,
    paneId,
    kind: "terminal",
  });
  safeFocus(surface);
  schedulePersist();
}

export function nextSurface() {
  const pane = get(activePane);
  if (!pane || pane.surfaces.length <= 1) return;
  const idx = pane.surfaces.findIndex((s) => s.id === pane.activeSurfaceId);
  pane.activeSurfaceId = pane.surfaces[(idx + 1) % pane.surfaces.length].id;
  workspaces.update((l) => [...l]);
  safeFocus(get(activeSurface));
}

export function prevSurface() {
  const pane = get(activePane);
  if (!pane || pane.surfaces.length <= 1) return;
  const idx = pane.surfaces.findIndex((s) => s.id === pane.activeSurfaceId);
  pane.activeSurfaceId =
    pane.surfaces[(idx - 1 + pane.surfaces.length) % pane.surfaces.length].id;
  workspaces.update((l) => [...l]);
  safeFocus(get(activeSurface));
}

export function selectSurfaceByNumber(num: number) {
  const pane = get(activePane);
  if (!pane) return;
  const idx = num === 9 ? pane.surfaces.length - 1 : num - 1;
  if (idx >= 0 && idx < pane.surfaces.length) {
    pane.activeSurfaceId = pane.surfaces[idx].id;
    workspaces.update((l) => [...l]);
    safeFocus(get(activeSurface));
  }
}

export function closeActiveSurface() {
  const ws = get(activeWorkspace);
  const pane = get(activePane);
  if (!ws || !pane) return;
  const idx = pane.surfaces.findIndex((s) => s.id === pane.activeSurfaceId);
  if (idx < 0) return;
  removeSurface(ws, pane, idx);
}

export async function openPreviewInPane(filePath: string) {
  const ws = get(activeWorkspace);
  const pane = get(activePane);
  if (!ws || !pane) return;
  const preview = await openPreview(filePath);
  const surface = {
    kind: "extension" as const,
    id: preview.id,
    surfaceTypeId: "preview:preview",
    title: preview.title,
    hasUnread: false,
    props: {
      filePath: preview.filePath,
      element: preview.element,
      watchId: preview.watchId,
    },
  };
  pane.surfaces.push(surface);
  pane.activeSurfaceId = surface.id;
  workspaces.update((l) => [...l]);
}

export function newSurfaceFromSidebar() {
  const pane = get(activePane);
  if (pane) newSurface(pane.id);
}
