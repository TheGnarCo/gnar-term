import { get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { workspaces, activeWorkspace, activePane, activeSurface } from "../stores/workspace";
import { createTerminalSurface } from "../terminal-service";
import { getAllPanes, isTerminalSurface, type Workspace, type Pane } from "../types";
import { openPreview } from "../../preview/index";
import { removePane } from "./pane-service";
import { safeFocus, getActiveCwd } from "./service-helpers";
import { clearScrollAnchor } from "../resize-guard";

export function selectSurface(paneId: string, surfaceId: string) {
  const ws = get(activeWorkspace);
  if (!ws) return;
  const pane = getAllPanes(ws.splitRoot).find(p => p.id === paneId);
  if (!pane) return;
  pane.activeSurfaceId = surfaceId;
  const s = pane.surfaces.find(s => s.id === surfaceId);
  if (s) s.hasUnread = false;
  workspaces.update(l => [...l]);
  safeFocus(s);
}

export function closeSurfaceById(paneId: string, surfaceId: string) {
  const ws = get(activeWorkspace);
  if (!ws) return;
  const pane = getAllPanes(ws.splitRoot).find(p => p.id === paneId);
  if (!pane) return;
  const idx = pane.surfaces.findIndex(s => s.id === surfaceId);
  if (idx < 0) return;
  removeSurface(ws, pane, idx);
}

function removeSurface(ws: Workspace, pane: Pane, surfaceIdx: number) {
  const surface = pane.surfaces[surfaceIdx];
  if (isTerminalSurface(surface)) {
    surface.terminal.dispose();
    if (surface.ptyId >= 0) {
      clearScrollAnchor(surface.ptyId);
      invoke("kill_pty", { ptyId: surface.ptyId }).catch(() => {});
    }
  }
  pane.surfaces.splice(surfaceIdx, 1);

  if (pane.surfaces.length === 0) {
    removePane(ws, pane);
  } else {
    pane.activeSurfaceId = pane.surfaces[Math.min(surfaceIdx, pane.surfaces.length - 1)].id;
    workspaces.update(l => [...l]);
    const s = pane.surfaces.find(s => s.id === pane.activeSurfaceId);
    safeFocus(s);
  }
}

export async function newSurface(paneId: string) {
  const ws = get(activeWorkspace);
  if (!ws) return;
  const pane = getAllPanes(ws.splitRoot).find(p => p.id === paneId);
  if (!pane) return;
  const cwd = await getActiveCwd();
  const surface = await createTerminalSurface(pane, cwd);
  workspaces.update(l => [...l]);
  safeFocus(surface);
}

export function nextSurface() {
  const pane = get(activePane);
  if (!pane || pane.surfaces.length <= 1) return;
  const idx = pane.surfaces.findIndex(s => s.id === pane.activeSurfaceId);
  pane.activeSurfaceId = pane.surfaces[(idx + 1) % pane.surfaces.length].id;
  workspaces.update(l => [...l]);
  safeFocus(get(activeSurface));
}

export function prevSurface() {
  const pane = get(activePane);
  if (!pane || pane.surfaces.length <= 1) return;
  const idx = pane.surfaces.findIndex(s => s.id === pane.activeSurfaceId);
  pane.activeSurfaceId = pane.surfaces[(idx - 1 + pane.surfaces.length) % pane.surfaces.length].id;
  workspaces.update(l => [...l]);
  safeFocus(get(activeSurface));
}

export function selectSurfaceByNumber(num: number) {
  const pane = get(activePane);
  if (!pane) return;
  const idx = num === 9 ? pane.surfaces.length - 1 : num - 1;
  if (idx >= 0 && idx < pane.surfaces.length) {
    pane.activeSurfaceId = pane.surfaces[idx].id;
    workspaces.update(l => [...l]);
    safeFocus(get(activeSurface));
  }
}

export function closeActiveSurface() {
  const ws = get(activeWorkspace);
  const pane = get(activePane);
  if (!ws || !pane) return;
  const idx = pane.surfaces.findIndex(s => s.id === pane.activeSurfaceId);
  if (idx < 0) return;
  removeSurface(ws, pane, idx);
}

export async function openPreviewInPane(filePath: string) {
  const ws = get(activeWorkspace);
  const pane = get(activePane);
  if (!ws || !pane) return;
  const preview = await openPreview(filePath);
  const surface = {
    kind: "preview" as const,
    id: preview.id,
    filePath: preview.filePath,
    title: preview.title,
    element: preview.element,
    watchId: preview.watchId,
    hasUnread: false,
  };
  pane.surfaces.push(surface);
  pane.activeSurfaceId = surface.id;
  workspaces.update(l => [...l]);
}

export function newSurfaceFromSidebar() {
  const pane = get(activePane);
  if (pane) newSurface(pane.id);
}
