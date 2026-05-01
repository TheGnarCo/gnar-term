import { get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import {
  nestedWorkspaces,
  activeNestedWorkspaceIdx,
  activeWorkspace,
  activePane,
  activeSurface,
} from "../stores/workspace";
import { renamingSurfaceId } from "../stores/ui";
import { createTerminalSurface } from "../terminal-service";
import {
  getAllPanes,
  uid,
  isTerminalSurface,
  isExtensionSurface,
  type NestedWorkspace,
  type Pane,
  type Surface,
  type PreviewSurface,
} from "../types";
import { removePane, splitPaneEmpty } from "./pane-service";
import { closeWorkspace, schedulePersist } from "./workspace-service";
import { findPreviewSurfaceByPath } from "./preview-surface-registry";
import { safeFocus, getCwdForSurface } from "./service-helpers";
import { eventBus } from "./event-bus";

export function selectSurface(paneId: string, surfaceId: string) {
  const ws = get(activeWorkspace);
  if (!ws) return;
  const pane = getAllPanes(ws.splitRoot).find((p) => p.id === paneId);
  if (!pane) return;
  pane.activeSurfaceId = surfaceId;
  const s = pane.surfaces.find((s) => s.id === surfaceId);
  if (s) s.hasUnread = false;
  nestedWorkspaces.update((l) => [...l]);
  eventBus.emit({ type: "surface:activated", id: surfaceId, paneId });
  void safeFocus(s);
}

/**
 * Close all extension surfaces matching the given surface type IDs across all
 * nestedWorkspaces. Used during extension deactivation to prevent orphaned surfaces.
 */
export function closeExtensionSurfaces(surfaceTypeIds: string[]): void {
  if (surfaceTypeIds.length === 0) return;
  const typeSet = new Set(surfaceTypeIds);
  const wsList = get(nestedWorkspaces);

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
  // Search all nestedWorkspaces — MCP can target a surface in a backgrounded
  // workspace, and the App.svelte callsite passes a paneId we know lives
  // in the active workspace, so an exhaustive scan covers both.
  for (const ws of get(nestedWorkspaces)) {
    const pane = getAllPanes(ws.splitRoot).find((p) => p.id === paneId);
    if (!pane) continue;
    const idx = pane.surfaces.findIndex((s) => s.id === surfaceId);
    if (idx < 0) return;
    removeSurface(ws, pane, idx);
    return;
  }
}

function removeSurface(ws: NestedWorkspace, pane: Pane, surfaceIdx: number) {
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
    // If this workspace has another pane (split view), collapse by
    // removing the now-empty pane. Otherwise the last surface in the
    // workspace just closed — close the whole workspace so the user
    // isn't left staring at an empty-state shell. Matches the
    // pty-exit path in terminal-service.ts.
    const paneCount = getAllPanes(ws.splitRoot).length;
    if (paneCount > 1) {
      removePane(ws, pane);
      nestedWorkspaces.update((l) => [...l]);
    } else {
      pane.resizeObserver?.disconnect();
      const wsIdx = get(nestedWorkspaces).indexOf(ws);
      if (wsIdx >= 0) closeWorkspace(wsIdx);
      return;
    }
  } else {
    pane.activeSurfaceId =
      pane.surfaces[Math.min(surfaceIdx, pane.surfaces.length - 1)]!.id;
    nestedWorkspaces.update((l) => [...l]);
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
  const sourceSurface = pane.surfaces.find(
    (s) => s.id === pane.activeSurfaceId,
  );
  const cwd = await getCwdForSurface(sourceSurface);
  const surface = await createTerminalSurface(pane, cwd);
  nestedWorkspaces.update((l) => [...l]);
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
  const sourceSurface = pane.surfaces.find(
    (s) => s.id === pane.activeSurfaceId,
  );
  const cwd = await getCwdForSurface(sourceSurface);
  const surface = await createTerminalSurface(pane, cwd);
  surface.title = command;
  surface.startupCommand = command;
  nestedWorkspaces.update((l) => [...l]);
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
  nestedWorkspaces.update((l) => [...l]);
  void safeFocus(get(activeSurface));
}

export function prevSurface() {
  const pane = get(activePane);
  if (!pane || pane.surfaces.length <= 1) return;
  const idx = pane.surfaces.findIndex((s) => s.id === pane.activeSurfaceId);
  pane.activeSurfaceId =
    pane.surfaces[(idx - 1 + pane.surfaces.length) % pane.surfaces.length]!.id;
  nestedWorkspaces.update((l) => [...l]);
  void safeFocus(get(activeSurface));
}

export function selectSurfaceByNumber(num: number) {
  const pane = get(activePane);
  if (!pane) return;
  const idx = num === 9 ? pane.surfaces.length - 1 : num - 1;
  if (idx >= 0 && idx < pane.surfaces.length) {
    pane.activeSurfaceId = pane.surfaces[idx]!.id;
    nestedWorkspaces.update((l) => [...l]);
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
  nestedWorkspaces.update((l) => [...l]);
}

export function openExtensionSurfaceInPaneById(
  paneId: string,
  surfaceTypeId: string,
  title: string,
  props?: Record<string, unknown>,
): { surfaceId: string; paneId: string } | null {
  // Search all nestedWorkspaces, not just the active one — this helper is called
  // from both UI code (where active workspace is set) and from MCP (where
  // the agent's target workspace may not be the user's focused one).
  let pane: Pane | undefined;
  for (const ws of get(nestedWorkspaces)) {
    const found = getAllPanes(ws.splitRoot).find((p) => p.id === paneId);
    if (found) {
      pane = found;
      break;
    }
  }
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
  nestedWorkspaces.update((l) => [...l]);
  return { surfaceId: surface.id, paneId: pane.id };
}

/**
 * Search all nestedWorkspaces for a surface by ID.
 * Returns the containing workspace, pane, and surface — or null if not found.
 */
export function findSurfaceLocation(
  surfaceId: string,
): { workspace: NestedWorkspace; pane: Pane; surface: Surface } | null {
  const wsList = get(nestedWorkspaces);
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
  nestedWorkspaces.update((l) => [...l]);
}

/**
 * Navigate to a surface: switch workspace, focus pane, select surface.
 * No-op if the surface is not found.
 */
export function focusSurfaceById(surfaceId: string): void {
  const loc = findSurfaceLocation(surfaceId);
  if (!loc) return;

  const { workspace: targetWs, pane: targetPane } = loc;
  const wsList = get(nestedWorkspaces);
  const targetIdx = wsList.findIndex((ws) => ws.id === targetWs.id);
  if (targetIdx < 0) return;

  // Switch workspace if needed
  const currentIdx = get(activeNestedWorkspaceIdx);
  if (currentIdx !== targetIdx) {
    activeNestedWorkspaceIdx.set(targetIdx);
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

/**
 * Push a fresh PreviewSurface onto the pane identified by `paneId`,
 * optionally focusing it. Returns the created surface or null if the pane
 * could not be found.
 *
 * Searches all nestedWorkspaces (not just the active one) — preview surfaces
 * can be spawned from MCP / extensions, where the target workspace may
 * differ from the user's focused one. Mirrors
 * openExtensionSurfaceInPaneById's lookup.
 */
export function createPreviewSurfaceInPane(
  paneId: string,
  path: string,
  options?: { focus?: boolean; title?: string },
): PreviewSurface | null {
  let owningWs: NestedWorkspace | undefined;
  let pane: Pane | undefined;
  for (const ws of get(nestedWorkspaces)) {
    const found = getAllPanes(ws.splitRoot).find((p) => p.id === paneId);
    if (found) {
      owningWs = ws;
      pane = found;
      break;
    }
  }
  if (!pane || !owningWs) return null;

  // Default the title to the file's basename when one isn't provided. Strip
  // the .md extension if present for a cleaner tab label.
  const basename = path.split("/").pop() || path;
  const title = options?.title ?? basename.replace(/\.md$/, "");

  const surface: PreviewSurface = {
    kind: "preview",
    id: uid(),
    title,
    path,
    hasUnread: false,
  };
  pane.surfaces.push(surface);
  if (options?.focus !== false) {
    pane.activeSurfaceId = surface.id;
  } else if (!pane.activeSurfaceId) {
    pane.activeSurfaceId = surface.id;
  }
  nestedWorkspaces.update((l) => [...l]);
  eventBus.emit({
    type: "surface:created",
    id: surface.id,
    paneId: pane.id,
    kind: "preview",
  });
  schedulePersist();
  return surface;
}

/**
 * Open a file as a preview surface in a new pane split to the right of the
 * currently active pane. If a preview for the same path is already open
 * anywhere, focuses it instead (same dedup semantics as spawn_preview MCP).
 */
export function openFileAsPreviewSplit(filePath: string): void {
  const existing = findPreviewSurfaceByPath(filePath);
  if (existing) {
    focusSurfaceById(existing.surfaceId);
    return;
  }

  const pane = get(activePane);
  if (!pane) return;

  const result = splitPaneEmpty(pane.id, "horizontal");
  if (!result) return;

  createPreviewSurfaceInPane(result.newPane.id, filePath);
}

export function renameActiveSurface(): void {
  const s = get(activeSurface);
  if (s) renamingSurfaceId.set(s.id);
}

export function renameSurface(surfaceId: string, title: string): void {
  nestedWorkspaces.update((wsList) => {
    for (const ws of wsList) {
      for (const pane of getAllPanes(ws.splitRoot)) {
        const s = pane.surfaces.find((s) => s.id === surfaceId);
        if (s) {
          s.title = title;
          return [...wsList];
        }
      }
    }
    return wsList;
  });
}
