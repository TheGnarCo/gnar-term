import { get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import {
  workspaces,
  activeWorkspaceIdx,
  activeWorkspace,
  activePane,
  activeSurface,
} from "../stores/workspace";
import { activeWorkspaceId } from "../stores/workspace";
import { renamingSurfaceId } from "../stores/ui";
import { createTerminalSurface } from "../terminal-service";
import {
  getAllPanes,
  uid,
  isTerminalSurface,
  isRegistrySurface,
  isPreviewSurface,
  type Workspace,
  type Pane,
  type Surface,
  type PreviewSurface,
} from "../types";
import { removePane, splitPaneEmpty } from "./pane-service";
import { closeWorkspace, schedulePersist } from "./workspace-runtime-service";
import { findPreviewSurfaceByPath } from "./preview-surface-registry";
import { canPreview } from "./preview-registry";
import { safeFocus, getCwdForSurface } from "./service-helpers";
import { activateWorkspace } from "./workspace-service";
import { eventBus } from "./event-bus";

export function selectSurface(paneId: string, surfaceId: string) {
  const ws = get(activeWorkspace);
  if (!ws) return;
  const pane = getAllPanes(ws.paneLayout).find((p) => p.id === paneId);
  if (!pane) return;
  pane.activeSurfaceId = surfaceId;
  const s = pane.surfaces.find((s) => s.id === surfaceId);
  if (s) s.hasUnread = false;
  workspaces.update((l) => [...l]);
  eventBus.emit({ type: "surface:activated", id: surfaceId, paneId });
  void safeFocus(s);
}

/**
 * Close all registry-backed surfaces matching the given surface type IDs across
 * all workspaces. Used during extension deactivation to prevent orphaned
 * surfaces (the registered Svelte component is about to be unloaded).
 */
export function closeRegistrySurfaces(surfaceTypeIds: string[]): void {
  if (surfaceTypeIds.length === 0) return;
  const typeSet = new Set(surfaceTypeIds);
  const wsList = get(workspaces);

  for (const ws of wsList) {
    const panes = getAllPanes(ws.paneLayout);
    for (const pane of panes) {
      // Collect indices in reverse order to preserve splice correctness
      for (let i = pane.surfaces.length - 1; i >= 0; i--) {
        const s = pane.surfaces[i]!;
        if (isRegistrySurface(s) && typeSet.has(s.surfaceTypeId)) {
          removeSurface(ws, pane, i);
        }
      }
    }
  }
}

export function closeSurfaceById(paneId: string, surfaceId: string) {
  // Search all workspaces — MCP can target a surface in a backgrounded
  // workspace, and the App.svelte callsite passes a paneId we know lives
  // in the active workspace, so an exhaustive scan covers both.
  for (const ws of get(workspaces)) {
    const pane = getAllPanes(ws.paneLayout).find((p) => p.id === paneId);
    if (!pane) continue;
    const idx = pane.surfaces.findIndex((s) => s.id === surfaceId);
    if (idx < 0) return;
    removeSurface(ws, pane, idx);
    return;
  }
}

async function spawnReplacementTerminal(
  ws: Workspace,
  pane: Pane,
): Promise<void> {
  // Inherit from the workspace itself: branches use worktreePath,
  // root workspaces use path. Falls back to the shell's default cwd
  // when neither is set (e.g. ad-hoc workspaces created without a
  // path).
  const cwd =
    (ws as { worktreePath?: string }).worktreePath ?? ws.path ?? undefined;
  const surface = await createTerminalSurface(pane, cwd);
  pane.activeSurfaceId = surface.id;
  workspaces.update((l) => [...l]);
  eventBus.emit({
    type: "surface:created",
    id: surface.id,
    paneId: pane.id,
    kind: "terminal",
  });
  void safeFocus(surface);
  schedulePersist();
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
    // Branch by what to do when the last surface in this pane goes:
    //   * split view (paneCount > 1) → collapse the empty pane.
    //   * dashboard workspace → close the workspace, since dashboards
    //     are single-surface and replacing with a terminal would
    //     change their nature.
    //   * otherwise → spawn a fresh terminal in the same pane so the
    //     workspace itself never gets deleted by tab-close. Cwd
    //     inherits from the workspace (worktreePath / path).
    const paneCount = getAllPanes(ws.paneLayout).length;
    if (paneCount > 1) {
      removePane(ws, pane);
      workspaces.update((l) => [...l]);
    } else if (ws.isDashboard === true) {
      pane.resizeObserver?.disconnect();
      const wsIdx = get(workspaces).indexOf(ws);
      if (wsIdx >= 0) closeWorkspace(wsIdx);
      return;
    } else {
      pane.activeSurfaceId = null;
      workspaces.update((l) => [...l]);
      void spawnReplacementTerminal(ws, pane);
      return;
    }
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
  const pane = getAllPanes(ws.paneLayout).find((p) => p.id === paneId);
  if (!pane) return;
  const sourceSurface = pane.surfaces.find(
    (s) => s.id === pane.activeSurfaceId,
  );
  const cwd = await getCwdForSurface(sourceSurface);
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
  const pane = getAllPanes(ws.paneLayout).find((p) => p.id === paneId);
  if (!pane) return;
  const sourceSurface = pane.surfaces.find(
    (s) => s.id === pane.activeSurfaceId,
  );
  const cwd = await getCwdForSurface(sourceSurface);
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

export function openRegistrySurfaceInPane(
  surfaceTypeId: string,
  title: string,
  props?: Record<string, unknown>,
) {
  const ws = get(activeWorkspace);
  const pane = get(activePane);
  if (!ws || !pane) return;
  const surface = {
    kind: "registry" as const,
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

/**
 * Open the per-workspace Settings panel as a new tab inside the workspace's
 * own runtime — never as a separate dashboard workspace, never as a split.
 * Reused for any workspace chip action that needs to surface inside its
 * owning workspace.
 *
 * Activates the root runtime workspace (materializes if not yet live;
 * Root runtime workspaces share their id with their RootWorkspace, ADR-004),
 * then dedupes by surfaceTypeId + props.rootWorkspaceId across every pane
 * of that workspace. If a matching tab already exists, focuses it; otherwise
 * pushes a fresh RegistrySurface onto the workspace's active pane.
 */
export type DashboardTabSpec =
  | {
      kind: "registry";
      surfaceTypeId: string;
      title: string;
      props?: Record<string, unknown>;
      /**
       * Subset of `props` used to dedupe an existing matching tab. When
       * omitted, dedup falls back to surfaceTypeId equality.
       */
      matchProps?: Record<string, unknown>;
    }
  | { kind: "preview"; path: string; title?: string };

/**
 * Open a dashboard surface as a tab inside the workspace's active pane.
 * Used by `DashboardContribution.openAsTab` implementations to spawn
 * dashboards (Workspace overview, Agentic, Diff, Settings) inline rather
 * than switching to a separate dashboard workspace.
 *
 * Activates the root runtime workspace (materializes if not yet live;
 * Root runtime workspaces share their id with their RootWorkspace, ADR-004),
 * then dedupes by spec identity across every pane. If a matching tab
 * already exists, focuses it; otherwise pushes a fresh surface onto the
 * workspace's active pane.
 */
export async function openDashboardSurfaceTab(
  rootWorkspaceId: string,
  spec: DashboardTabSpec,
): Promise<void> {
  await activateWorkspace(rootWorkspaceId);

  const ws = get(workspaces).find((w) => w.id === rootWorkspaceId);
  if (!ws) return;

  for (const pane of getAllPanes(ws.paneLayout)) {
    const existing = pane.surfaces.find((s) => {
      if (spec.kind === "preview") {
        return isPreviewSurface(s) && s.path === spec.path;
      }
      if (!isRegistrySurface(s) || s.surfaceTypeId !== spec.surfaceTypeId) {
        return false;
      }
      const match = spec.matchProps;
      if (!match) return true;
      const sProps = (s.props ?? {}) as Record<string, unknown>;
      return Object.entries(match).every(([k, v]) => sProps[k] === v);
    });
    if (existing) {
      ws.activePaneId = pane.id;
      selectSurface(pane.id, existing.id);
      return;
    }
  }

  const panes = getAllPanes(ws.paneLayout);
  const targetPane = panes.find((p) => p.id === ws.activePaneId) ?? panes[0];
  if (!targetPane) return;

  let surface: Surface;
  if (spec.kind === "preview") {
    const basename = spec.path.split("/").pop() || spec.path;
    const title = spec.title ?? basename.replace(/\.md$/, "");
    surface = {
      kind: "preview",
      id: uid(),
      title,
      path: spec.path,
      hasUnread: false,
    };
  } else {
    surface = {
      kind: "registry",
      id: uid(),
      surfaceTypeId: spec.surfaceTypeId,
      title: spec.title,
      hasUnread: false,
      props: spec.props,
    };
  }
  targetPane.surfaces.push(surface);
  targetPane.activeSurfaceId = surface.id;
  ws.activePaneId = targetPane.id;
  workspaces.update((l) => [...l]);
  eventBus.emit({
    type: "surface:created",
    id: surface.id,
    paneId: targetPane.id,
    kind: surface.kind,
  });
  void safeFocus(surface);
  schedulePersist();
}

export async function openWorkspaceSettingsTab(
  rootWorkspaceId: string,
): Promise<void> {
  await openDashboardSurfaceTab(rootWorkspaceId, {
    kind: "registry",
    surfaceTypeId: "core:workspace-settings",
    title: "Workspace Settings",
    props: { rootWorkspaceId },
    matchProps: { rootWorkspaceId },
  });
}

export function openRegistrySurfaceInPaneById(
  paneId: string,
  surfaceTypeId: string,
  title: string,
  props?: Record<string, unknown>,
): { surfaceId: string; paneId: string } | null {
  // Search all workspaces, not just the active one — this helper is called
  // from both UI code (where active workspace is set) and from MCP (where
  // the agent's target workspace may not be the user's focused one).
  let pane: Pane | undefined;
  for (const ws of get(workspaces)) {
    const found = getAllPanes(ws.paneLayout).find((p) => p.id === paneId);
    if (found) {
      pane = found;
      break;
    }
  }
  if (!pane) return null;
  const surface = {
    kind: "registry" as const,
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
    for (const pane of getAllPanes(ws.paneLayout)) {
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
    activeWorkspaceId.set(targetWs.id);
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
  // Per ADR-004: Dashboard Workspaces are "single" surfaces — no tab
  // strip, no ⌘T. Tab Workspaces (root + Branched) own their tabs.
  const ws = get(activeWorkspace);
  if (ws?.isDashboard === true) return;
  const pane = get(activePane);
  if (pane) void newSurface(pane.id);
}

/**
 * Push a fresh PreviewSurface onto the pane identified by `paneId`,
 * optionally focusing it. Returns the created surface or null if the pane
 * could not be found.
 *
 * Searches all workspaces (not just the active one) — preview surfaces
 * can be spawned from MCP / extensions, where the target workspace may
 * differ from the user's focused one. Mirrors
 * openRegistrySurfaceInPaneById's lookup.
 */
export function createPreviewSurfaceInPane(
  paneId: string,
  path: string,
  options?: { focus?: boolean; title?: string },
): PreviewSurface | null {
  let owningWs: Workspace | undefined;
  let pane: Pane | undefined;
  for (const ws of get(workspaces)) {
    const found = getAllPanes(ws.paneLayout).find((p) => p.id === paneId);
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
  workspaces.update((l) => [...l]);
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
 *
 * Files whose extension has no registered previewer are handed off to the
 * system default application (`open_with_default_app`) instead of opening
 * an empty preview surface that immediately renders an error.
 */
export function openFileAsPreviewSplit(filePath: string): void {
  const existing = findPreviewSurfaceByPath(filePath);
  if (existing) {
    focusSurfaceById(existing.surfaceId);
    return;
  }

  if (!canPreview(filePath)) {
    void invoke("open_with_default_app", { path: filePath }).catch((err) =>
      console.warn(
        `[surface] open_with_default_app failed for ${filePath}:`,
        err,
      ),
    );
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
  workspaces.update((wsList) => {
    for (const ws of wsList) {
      for (const pane of getAllPanes(ws.paneLayout)) {
        const s = pane.surfaces.find((s) => s.id === surfaceId);
        if (s) {
          s.title = title;
          // Stamp the user's explicit choice on terminal surfaces so OSC
          // 0/2 (title) and OSC 7 (cwd) escape sequences and agent
          // detach restore won't clobber it. Non-terminal surfaces
          // (preview, extension) don't receive escape-sequence titles,
          // so the field is meaningless for them.
          if (isTerminalSurface(s)) {
            s.userDefinedTitle = title;
          }
          return [...wsList];
        }
      }
    }
    return wsList;
  });
}
