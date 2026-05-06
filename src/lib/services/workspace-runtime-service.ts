import { get, derived } from "svelte/store";
import type { Readable } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import {
  workspaces,
  activeWorkspaceIdx,
  activeWorkspace,
  activeSurface,
  activePseudoWorkspaceId,
  zoomedSurfaceId,
  workspaceHistory,
  serializeLayout,
} from "../stores/workspace";

// Re-exported so existing call sites that import serializeLayout from
// workspace-runtime-service continue to compile after the dedupe.
export { serializeLayout };
import {
  showInputPrompt,
  showConfirmPrompt,
  sidebarVisible,
} from "../stores/ui";
import { createTerminalSurface } from "../terminal-service";
import {
  uid,
  getAllPanes,
  getAllSurfaces,
  isTerminalSurface,
  findParentSplit,
  replaceNodeInTree,
  type Workspace,
  type Pane,
  type SplitNode,
  type PreviewSurface,
} from "../types";
import {
  saveConfig,
  getConfig,
  type WorkspaceTemplate,
  type LayoutNode,
} from "../config";
import { safeFocus } from "./service-helpers";
import { readTerminalBuffer, writeSessionLog } from "./session-log-service";
import { eventBus } from "./event-bus";
import {
  appendRootRow,
  removeRootRow,
  insertRootRow,
} from "../stores/root-row-order";
import {
  addChildToWorkspace,
  insertChildIntoWorkspace,
  updateWorkspace,
} from "./workspace-service";
import { getWorkspace } from "../stores/workspace";
import { schedulePersist, persistWorkspaces } from "./workspace-persist";

// Re-exported for existing call sites that import these from
// workspace-runtime-service. The implementations live in
// workspace-persist so workspace-service can also schedule persists
// without dragging in this module's full dependency graph.
export { schedulePersist, persistWorkspaces };

export async function createWorkspaceFromDef(
  def: WorkspaceTemplate,
  options?: { restoring?: boolean },
): Promise<string> {
  const wsName = def.name || `Workspace ${get(workspaces).length + 1}`;
  const rootCwd = def.cwd;
  const rootEnv = def.env;
  const restoring = options?.restoring === true;

  async function buildTree(
    nodeDef: LayoutNode,
    inheritedCwd?: string,
    inheritedEnv?: Record<string, string>,
  ): Promise<SplitNode> {
    if ("pane" in nodeDef) {
      const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
      for (const sDef of nodeDef.pane.surfaces) {
        const cwd = sDef.cwd || inheritedCwd;
        if (sDef.type === "extension" && sDef.extensionType) {
          // Generic extension surface from config
          const surface = {
            kind: "extension" as const,
            id: uid(),
            surfaceTypeId: sDef.extensionType,
            title: sDef.name || sDef.extensionType,
            hasUnread: false,
            props: sDef.extensionProps || {},
          };
          pane.surfaces.push(surface);
          if (!pane.activeSurfaceId || sDef.focus)
            pane.activeSurfaceId = surface.id;
        } else if (sDef.type === "preview" && sDef.path) {
          // Preview surface from config — backed by a file path. The
          // markdown previewer is what renders markdown-component directives;
          // any previewable file type works here.
          const basename = sDef.path.split("/").pop() || sDef.path;
          const surface: PreviewSurface = {
            kind: "preview",
            id: uid(),
            title: sDef.name || basename.replace(/\.md$/, ""),
            path: sDef.path,
            hasUnread: false,
          };
          pane.surfaces.push(surface);
          if (!pane.activeSurfaceId || sDef.focus)
            pane.activeSurfaceId = surface.id;
        } else {
          const envMerged = { ...inheritedEnv, ...sDef.env };
          const surface = await createTerminalSurface(
            pane,
            cwd,
            Object.keys(envMerged).length > 0 ? envMerged : undefined,
          );
          if (sDef.name) surface.title = sDef.name;
          if (sDef.command) {
            // Defined command is the persistent record; on restore we
            // require user approval before running it unless the root
            // workspace has autoRunRestoreCommands enabled.
            surface.definedCommand = sDef.command;
            if (restoring) {
              const rootWs = def.rootWorkspaceId
                ? getWorkspace(def.rootWorkspaceId)
                : null;
              if (rootWs?.autoRunRestoreCommands !== false) {
                surface.startupCommand = sDef.command;
              } else {
                surface.pendingRestoreCommand = true;
              }
            } else {
              surface.startupCommand = sDef.command;
            }
          }
          if (sDef.focus) pane.activeSurfaceId = surface.id;
        }
      }
      if (pane.surfaces.length === 0) {
        await createTerminalSurface(pane, inheritedCwd, inheritedEnv);
      }
      return { type: "pane", pane };
    } else {
      const left = await buildTree(
        nodeDef.children[0],
        inheritedCwd,
        inheritedEnv,
      );
      const right = await buildTree(
        nodeDef.children[1],
        inheritedCwd,
        inheritedEnv,
      );
      return {
        type: "split",
        direction: nodeDef.direction,
        ratio: nodeDef.split || 0.5,
        children: [left, right],
      };
    }
  }

  let paneLayout: SplitNode;
  if (def.layout) {
    paneLayout = await buildTree(def.layout, rootCwd, rootEnv);
  } else {
    const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
    await createTerminalSurface(pane, rootCwd, rootEnv);
    paneLayout = { type: "pane", pane };
  }

  // Build the workspace from top-level `def` fields. Structural and
  // discriminant fields are first-class on the template — extensions
  // pass them at the top level, not via a metadata blob.
  const ws: Workspace = {
    // Reuse the persisted id when restoring so rootRowOrder survives
    // a restart; mint a fresh one for first-launch creation.
    id: def.id ?? uid(),
    name: wsName,
    paneLayout,
    activePaneId: getAllPanes(paneLayout)[0]?.id ?? null,
  };

  if (def.rootWorkspaceId !== undefined)
    ws.rootWorkspaceId = def.rootWorkspaceId;
  if (def.isDashboard !== undefined) ws.isDashboard = def.isDashboard;
  if (def.dashboardContributionId !== undefined)
    ws.dashboardContributionId = def.dashboardContributionId;
  if (def.dashboardWorkspaceId !== undefined)
    ws.dashboardWorkspaceId = def.dashboardWorkspaceId;
  if (def.lastActiveBranchedWorkspaceId !== undefined)
    ws.lastActiveBranchedWorkspaceId = def.lastActiveBranchedWorkspaceId;
  if (def.locked !== undefined) ws.locked = def.locked;
  if (def.autoRunRestoreCommands !== undefined)
    ws.autoRunRestoreCommands = def.autoRunRestoreCommands;
  if (def.path !== undefined) ws.path = def.path;
  if (def.color !== undefined) ws.color = def.color;
  if (def.isGit !== undefined) ws.isGit = def.isGit;
  if (def.createdAt !== undefined) ws.createdAt = def.createdAt;

  // Branch fields (BranchedWorkspace extension)
  const bw = ws as Workspace & {
    worktreePath?: string;
    branch?: string;
    baseBranch?: string;
    repoPath?: string;
  };
  if (def.worktreePath !== undefined) bw.worktreePath = def.worktreePath;
  if (def.branch !== undefined) bw.branch = def.branch;
  if (def.baseBranch !== undefined) bw.baseBranch = def.baseBranch;
  if (def.repoPath !== undefined) bw.repoPath = def.repoPath;

  // Provenance (worktree-service / spawn-helper)
  if (def.spawnedBy !== undefined) ws.spawnedBy = def.spawnedBy;
  if (def.spawnedFromIssues !== undefined)
    ws.spawnedFromIssues = def.spawnedFromIssues;
  if (def.extensionData !== undefined) ws.extensionData = def.extensionData;

  // Root-shaped Workspaces own a (possibly empty) members list. Branches
  // and Dashboards omit the field entirely. reclaimBranchedWorkspaces fills
  // in actual member ids after the loop completes.
  const isRootShaped =
    typeof ws.rootWorkspaceId !== "string" &&
    ws.isDashboard !== true &&
    typeof bw.worktreePath !== "string";
  if (isRootShaped && ws.branchedWorkspaceIds === undefined) {
    ws.branchedWorkspaceIds = [];
  }

  // A runtime workspace whose id matches an existing root entry IS the
  // Workspace's own Root tab surface — merge the runtime fields onto
  // the existing record-shaped entry rather than appending a duplicate
  // row. Otherwise append as a new entry.
  const isWorkspaceOwnRoot = getWorkspace(ws.id) !== undefined;
  if (isWorkspaceOwnRoot) {
    workspaces.update((list) =>
      list.map((existing) =>
        existing.id === ws.id
          ? {
              ...existing,
              paneLayout: ws.paneLayout,
              activePaneId: ws.activePaneId,
            }
          : existing,
      ),
    );
  } else {
    workspaces.update((list) => [...list, ws]);
    // Branches (have rootWorkspaceId) live nested inside their root and
    // never get a row of their own. Roots get a `kind: "workspace"` row
    // here; the matching WorkspaceRecord append (via `addWorkspace`)
    // is idempotent on the same id+kind.
    if (typeof ws.rootWorkspaceId !== "string") {
      appendRootRow({ kind: "workspace", id: ws.id });
    }
  }
  eventBus.emit({ type: "workspace:created", id: ws.id, name: wsName });
  // Route through switchWorkspace so workspace:activated listeners
  // (e.g. agentic-orchestrator's dashboard workspace re-spawn hook)
  // fire on creation — auto-switching to the fresh workspace matches
  // the user-driven switch path. Session restore skips the auto-switch
  // because it'll restore the persisted active idx once every workspace
  // has been rebuilt, and we don't want N+1 activation events along
  // the way.
  const finalIdx = get(workspaces).findIndex((w) => w.id === ws.id);
  if (!restoring) {
    if (finalIdx >= 0) switchWorkspace(finalIdx);
    // Reveal the new banner: when the user creates a root-shaped workspace
    // (not a branch, dashboard, or session restore), make sure the primary
    // sidebar is open so the new row is visible.
    if (isRootShaped) sidebarVisible.set(true);
  } else {
    if (finalIdx >= 0) activeWorkspaceIdx.set(finalIdx);
  }
  const ap = getAllPanes(paneLayout).find((p) => p.id === ws.activePaneId);
  const as_ = ap?.surfaces.find((s) => s.id === ap.activeSurfaceId);
  void safeFocus(as_);
  schedulePersist();
  return ws.id;
}

export function switchWorkspace(idx: number) {
  const wsList = get(workspaces);
  if (idx < 0 || idx >= wsList.length) return;
  const previousId =
    get(activeWorkspaceIdx) >= 0
      ? (wsList[get(activeWorkspaceIdx)]?.id ?? null)
      : null;
  const newId = wsList[idx]!.id;
  activePseudoWorkspaceId.set(null);
  zoomedSurfaceId.set(null);
  activeWorkspaceIdx.set(idx);
  workspaceHistory.update(([, cur]) => [cur, newId]);
  // Record the last-active Branch on the root Workspace
  // so activateWorkspace can restore it on the next switch.
  const ws = wsList[idx];
  const parentWsId = ws?.rootWorkspaceId;
  if (ws && parentWsId) {
    updateWorkspace(parentWsId, { lastActiveBranchedWorkspaceId: ws.id });
  }
  eventBus.emit({
    type: "workspace:activated",
    id: newId,
    previousId,
  });
  void safeFocus(get(activeSurface));
}

export function switchToLastWorkspace(): void {
  const [prevId] = get(workspaceHistory);
  if (!prevId) return;
  const idx = get(workspaces).findIndex((ws) => ws.id === prevId);
  if (idx >= 0) switchWorkspace(idx);
}

export function closeWorkspace(idx: number) {
  const wsList = get(workspaces);
  const ws = wsList[idx];
  if (!ws) return;

  // Capture scrollback buffers synchronously BEFORE disposal
  const captures: Array<{
    content: string;
    surfaceName: string;
    surfaceId: string;
  }> = [];
  for (const surface of getAllSurfaces(ws)) {
    if (isTerminalSurface(surface) && surface.ptyId >= 0) {
      const content = readTerminalBuffer(surface);
      if (content) {
        captures.push({
          content,
          surfaceName: surface.title ?? surface.id,
          surfaceId: surface.id,
        });
      }
    }
  }
  const wsId = ws.id;
  for (const cap of captures) {
    void writeSessionLog(cap.content, cap.surfaceName, cap.surfaceId, wsId);
  }

  for (const pane of getAllPanes(ws.paneLayout)) {
    pane.resizeObserver?.disconnect();
  }
  for (const surf of getAllSurfaces(ws)) {
    if (isTerminalSurface(surf)) {
      surf.terminal.dispose();
      if (surf.ptyId >= 0) {
        // PTY may already have exited — safe to ignore
        invoke("kill_pty", { ptyId: surf.ptyId }).catch(() => {});
      }
    }
  }
  // Clear zoom if the workspace being closed contains the currently-zoomed surface
  const zoomed = get(zoomedSurfaceId);
  if (zoomed && getAllSurfaces(ws).some((s) => s.id === zoomed)) {
    zoomedSurfaceId.set(null);
  }
  workspaces.update((list) => list.filter((_, i) => i !== idx));
  activeWorkspaceIdx.set(
    Math.min(get(activeWorkspaceIdx), get(workspaces).length - 1),
  );
  removeRootRow({ kind: "workspace", id: wsId });
  eventBus.emit({ type: "workspace:closed", id: wsId });
  schedulePersist();
}

export function renameWorkspace(idx: number, name: string) {
  const oldName = get(workspaces)[idx]?.name ?? "";
  const id = get(workspaces)[idx]?.id ?? "";
  workspaces.update((list) => {
    list[idx]!.name = name;
    return [...list];
  });
  eventBus.emit({ type: "workspace:renamed", id, oldName, newName: name });
  schedulePersist();
}

export { toggleWorkspaceLock } from "./workspace-service";

export function reorderWorkspaces(fromIdx: number, toIdx: number) {
  const activeId = get(workspaces)[get(activeWorkspaceIdx)]?.id;
  workspaces.update((list) => {
    const item = list.splice(fromIdx, 1)[0]!;
    const adjustedTo = fromIdx < toIdx ? toIdx - 1 : toIdx;
    list.splice(adjustedTo, 0, item);
    return [...list];
  });
  if (activeId) {
    const newIdx = get(workspaces).findIndex((ws) => ws.id === activeId);
    if (newIdx >= 0) activeWorkspaceIdx.set(newIdx);
  }
  schedulePersist();
}

export async function saveCurrentWorkspace() {
  const ws = get(activeWorkspace);
  if (!ws) return;
  const surface = get(activeSurface);
  const name = await showInputPrompt("Workspace name", ws.name);
  if (!name) return;
  const layout = serializeLayout(ws.paneLayout);
  const activeCwd =
    surface && isTerminalSurface(surface) ? surface.cwd : undefined;
  const wsDef: WorkspaceTemplate = { name, cwd: activeCwd || "~", layout };
  const config = getConfig();
  const commands = config.commands || [];
  const existing = commands.findIndex((c) => c.name === name);
  const entry = { name, workspace: wsDef };
  if (existing >= 0) {
    commands[existing] = entry;
  } else {
    commands.push(entry);
  }
  await saveConfig({ commands });
}

export async function closeAllWorkspaces(): Promise<void> {
  const count = get(workspaces).length;
  if (count === 0) return;
  const confirmed = await showConfirmPrompt(
    `Close all ${count} workspace${count === 1 ? "" : "s"}? This will dispose every terminal and cannot be undone.`,
    {
      title: "Close All Workspaces",
      confirmLabel: "Close All",
      cancelLabel: "Cancel",
    },
  );
  if (!confirmed) return;
  // closeWorkspace mutates the store and shifts indices, so always pop
  // index 0 until the list is empty.
  while (get(workspaces).length > 0) {
    closeWorkspace(0);
  }
}

/**
 * Collapse an empty pane out of a workspace's split tree. Mirrors the
 * structural piece of `removePane` (in pane-service) without the
 * resize-observer / event-bus / focus side-effects — used by tab-drag
 * services after they move a surface out of a pane that becomes empty.
 *
 * Caller must guarantee `paneId` is NOT the paneLayout pane (a single
 * empty pane at the root has no sibling to collapse into and is the
 * caller's responsibility to handle).
 */
function collapseEmptyPaneInWorkspace(ws: Workspace, paneId: string): void {
  const parentInfo = findParentSplit(ws.paneLayout, paneId);
  if (!parentInfo || parentInfo.parent.type !== "split") return;
  const sibling = parentInfo.parent.children[parentInfo.index === 0 ? 1 : 0]!;
  if (ws.paneLayout === parentInfo.parent) {
    ws.paneLayout = sibling;
  } else {
    replaceNodeInTree(ws.paneLayout, parentInfo.parent, sibling);
  }
}

/**
 * Spawn a new child workspace whose paneLayout is a single pane carrying the
 * dragged surface. Inherits the source workspace's rootWorkspaceId
 * so a tab dropped from a Branch inside a root Workspace lands as a
 * sibling within the same root Workspace.
 *
 * Refuses to leave the source empty: when the source workspace has only
 * one surface total, this is a no-op (the caller — tab-drag — also
 * guards against this when computing the drop target, but the service
 * enforces the invariant in case callers skip the check).
 */
export function createWorkspaceFromSurface(
  surfaceId: string,
  sourcePaneId: string,
  sourceWorkspaceId: string,
  insertOptions?:
    | { kind: "root"; insertIdx: number }
    | {
        kind: "workspace";
        positionInWorkspace: number;
        targetWorkspaceId?: string;
      },
): void {
  const allWs = get(workspaces);
  const srcWs = allWs.find((w) => w.id === sourceWorkspaceId);
  if (!srcWs) return;
  if (getAllSurfaces(srcWs).length < 2) return;

  const sourcePane = getAllPanes(srcWs.paneLayout).find(
    (p) => p.id === sourcePaneId,
  );
  if (!sourcePane) return;
  const surfaceIdx = sourcePane.surfaces.findIndex((s) => s.id === surfaceId);
  if (surfaceIdx === -1) return;
  const [surface] = sourcePane.surfaces.splice(surfaceIdx, 1);
  if (!surface) return;

  if (sourcePane.activeSurfaceId === surfaceId) {
    sourcePane.activeSurfaceId = sourcePane.surfaces[0]?.id ?? null;
  }

  // If the source pane is now empty (and isn't the workspace's root),
  // fold it out of the split tree. The workspace itself survives —
  // we already enforced >1 surface above.
  if (
    sourcePane.surfaces.length === 0 &&
    !(
      srcWs.paneLayout.type === "pane" &&
      srcWs.paneLayout.pane.id === sourcePaneId
    )
  ) {
    collapseEmptyPaneInWorkspace(srcWs, sourcePaneId);
  }

  const newPane: Pane = {
    id: uid(),
    surfaces: [surface],
    activeSurfaceId: surface.id,
  };
  const srcWorkspaceId = srcWs?.rootWorkspaceId;
  const effectiveWorkspaceId =
    (insertOptions?.kind === "workspace" && insertOptions.targetWorkspaceId) ||
    srcWorkspaceId;
  const newWs: Workspace = {
    id: uid(),
    name: surface.title || "New Workspace",
    paneLayout: { type: "pane", pane: newPane },
    activePaneId: newPane.id,
    ...(effectiveWorkspaceId ? { rootWorkspaceId: effectiveWorkspaceId } : {}),
  };

  workspaces.update((list) => [...list, newWs]);
  // Branches (have rootWorkspaceId) never appear as a root row — they
  // live nested inside their root's branch list. Roots created via
  // pane-split-into-workspace get a `kind: "workspace"` row here.
  if (typeof newWs.rootWorkspaceId !== "string") {
    if (insertOptions?.kind === "root") {
      insertRootRow(insertOptions.insertIdx, {
        kind: "workspace",
        id: newWs.id,
      });
    } else {
      appendRootRow({ kind: "workspace", id: newWs.id });
    }
  }
  if (effectiveWorkspaceId) {
    if (insertOptions?.kind === "workspace") {
      insertChildIntoWorkspace(
        effectiveWorkspaceId,
        newWs.id,
        insertOptions.positionInWorkspace,
      );
    } else {
      addChildToWorkspace(effectiveWorkspaceId, newWs.id);
    }
  }
  schedulePersist();
}

// Re-exported so pane-service (which lives next to it) can collapse a
// pane after moving a surface across workspaces without duplicating
// the helper.
export { collapseEmptyPaneInWorkspace };

// Derived store: one flat Map<workspaceId, Surface[]> rebuilt per workspace
// update. WorkspaceItem rows still re-run their reactive statement on every
// workspaces emission, but each pays only a Map.get() O(1) lookup instead of
// calling getAllSurfaces independently — O(W×S) once vs O(R×W×S) before.
export const workspaceSurfaceMap: Readable<
  Map<string, ReturnType<typeof getAllSurfaces>>
> = derived(workspaces, ($ws) => {
  const m = new Map<string, ReturnType<typeof getAllSurfaces>>();
  for (const ws of $ws) m.set(ws.id, getAllSurfaces(ws));
  return m;
});
