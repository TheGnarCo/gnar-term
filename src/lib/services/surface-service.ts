import { get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import {
  workspaces,
  activeWorkspaceIdx,
  activeWorkspace,
  activePane,
  activeSurface,
} from "../stores/workspace";
import { createTerminalSurface } from "../terminal-service";
import {
  getAllPanes,
  uid,
  isTerminalSurface,
  isExtensionSurface,
  type Workspace,
  type Pane,
  type Surface,
} from "../types";
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
  void safeFocus(s);
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
        const s = pane.surfaces[i]!;
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
  const surface = pane.surfaces[surfaceIdx]!;
  const surfaceId = surface.id;
  const paneId = pane.id;
  if (isTerminalSurface(surface)) {
    surface.terminal.dispose();
    if (surface.ptyId >= 0) {
      // PTY may already have exited — safe to ignore
      invoke("kill_pty", { ptyId: surface.ptyId }).catch(() => {});
    }
  }
  pane.surfaces.splice(surfaceIdx, 1);
  eventBus.emit({ type: "surface:closed", id: surfaceId, paneId });

  if (pane.surfaces.length === 0) {
    removePane(ws, pane);
  } else {
    pane.activeSurfaceId =
      pane.surfaces[Math.min(surfaceIdx, pane.surfaces.length - 1)]!.id;
    workspaces.update((l) => [...l]);
    const s = pane.surfaces.find((s) => s.id === pane.activeSurfaceId);
    void safeFocus(s);
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
  void safeFocus(surface);
  schedulePersist();
}

export async function newSurfaceWithCommand(paneId: string, command: string) {
  const ws = get(activeWorkspace);
  if (!ws) return;
  const pane = getAllPanes(ws.splitRoot).find((p) => p.id === paneId);
  if (!pane) return;
  const cwd = await getActiveCwd();
  const surface = await createTerminalSurface(pane, cwd);
  surface.title = command;
  surface.startupCommand = command;
  workspaces.update((l) => [...l]);
  eventBus.emit({
    type: "surface:created",
    id: surface.id,
    paneId,
    kind: "terminal",
  });
  void safeFocus(surface);
  schedulePersist();
}

export function nextSurface() {
  const pane = get(activePane);
  if (!pane || pane.surfaces.length <= 1) return;
  const idx = pane.surfaces.findIndex((s) => s.id === pane.activeSurfaceId);
  pane.activeSurfaceId = pane.surfaces[(idx + 1) % pane.surfaces.length]!.id;
  workspaces.update((l) => [...l]);
  void safeFocus(get(activeSurface));
}

export function prevSurface() {
  const pane = get(activePane);
  if (!pane || pane.surfaces.length <= 1) return;
  const idx = pane.surfaces.findIndex((s) => s.id === pane.activeSurfaceId);
  pane.activeSurfaceId =
    pane.surfaces[(idx - 1 + pane.surfaces.length) % pane.surfaces.length]!.id;
  workspaces.update((l) => [...l]);
  void safeFocus(get(activeSurface));
}

export function selectSurfaceByNumber(num: number) {
  const pane = get(activePane);
  if (!pane) return;
  const idx = num === 9 ? pane.surfaces.length - 1 : num - 1;
  if (idx >= 0 && idx < pane.surfaces.length) {
    pane.activeSurfaceId = pane.surfaces[idx]!.id;
    workspaces.update((l) => [...l]);
    void safeFocus(get(activeSurface));
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

export function openExtensionSurfaceInPane(
  surfaceTypeId: string,
  title: string,
  props?: Record<string, unknown>,
) {
  const ws = get(activeWorkspace);
  const pane = get(activePane);
  if (!ws || !pane) return;
  const surface = {
    kind: "extension" as const,
    id: uid(),
    surfaceTypeId,
    title,
    hasUnread: false,
    props: props || {},
  };
  pane.surfaces.push(surface);
  pane.activeSurfaceId = surface.id;
  workspaces.update((l) => [...l]);
}

export function openExtensionSurfaceInPaneById(
  paneId: string,
  surfaceTypeId: string,
  title: string,
  props?: Record<string, unknown>,
): { surfaceId: string; paneId: string } | null {
  const ws = get(activeWorkspace);
  if (!ws) return null;
  const pane = getAllPanes(ws.splitRoot).find((p) => p.id === paneId);
  if (!pane) return null;
  const surface = {
    kind: "extension" as const,
    id: uid(),
    surfaceTypeId,
    title,
    hasUnread: false,
    props: props || {},
  };
  pane.surfaces.push(surface);
  pane.activeSurfaceId = surface.id;
  workspaces.update((l) => [...l]);
  return { surfaceId: surface.id, paneId: pane.id };
}

/**
 * Search all workspaces for a surface by ID.
 * Returns the containing workspace, pane, and surface — or null if not found.
 */
export function findSurfaceLocation(
  surfaceId: string,
): { workspace: Workspace; pane: Pane; surface: Surface } | null {
  const wsList = get(workspaces);
  for (const ws of wsList) {
    for (const pane of getAllPanes(ws.splitRoot)) {
      const surface = pane.surfaces.find((s) => s.id === surfaceId);
      if (surface) return { workspace: ws, pane, surface };
    }
  }
  return null;
}

/**
 * Set hasUnread=true on a surface by ID, regardless of which workspace it's in.
 * No-op if the surface is not found.
 */
export function markSurfaceUnreadById(surfaceId: string): void {
  const loc = findSurfaceLocation(surfaceId);
  if (!loc) return;
  loc.surface.hasUnread = true;
  workspaces.update((l) => [...l]);
}

/**
 * Navigate to a surface: switch workspace, focus pane, select surface.
 * No-op if the surface is not found.
 */
export function focusSurfaceById(surfaceId: string): void {
  const loc = findSurfaceLocation(surfaceId);
  if (!loc) return;

  const { workspace: targetWs, pane: targetPane } = loc;
  const wsList = get(workspaces);
  const targetIdx = wsList.findIndex((ws) => ws.id === targetWs.id);
  if (targetIdx < 0) return;

  // Switch workspace if needed
  const currentIdx = get(activeWorkspaceIdx);
  if (currentIdx !== targetIdx) {
    activeWorkspaceIdx.set(targetIdx);
    eventBus.emit({
      type: "workspace:activated",
      id: targetWs.id,
      previousId: currentIdx >= 0 ? (wsList[currentIdx]?.id ?? null) : null,
    });
  }

  // Focus the pane
  targetWs.activePaneId = targetPane.id;

  // Select the surface (clears hasUnread, updates store, focuses)
  selectSurface(targetPane.id, surfaceId);
}

export function newSurfaceFromSidebar() {
  const pane = get(activePane);
  if (pane) void newSurface(pane.id);
}
