import { get, derived } from "svelte/store";
import type { Readable } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import {
  nestedWorkspaces,
  activeNestedWorkspaceIdx,
  activeWorkspace,
  activeSurface,
  activePseudoWorkspaceId,
  zoomedSurfaceId,
} from "../stores/nested-workspace";
import { showInputPrompt, showConfirmPrompt } from "../stores/ui";
import { createTerminalSurface } from "../terminal-service";
import {
  uid,
  getAllPanes,
  getAllSurfaces,
  isTerminalSurface,
  isExtensionSurface,
  isPreviewSurface,
  findParentSplit,
  replaceNodeInTree,
  type NestedWorkspace,
  type Pane,
  type SplitNode,
  type PreviewSurface,
} from "../types";
import {
  saveConfig,
  saveState,
  getConfig,
  type NestedWorkspaceDef,
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
  addNestedWorkspaceToWorkspace,
  insertNestedWorkspaceIntoWorkspace,
  updateWorkspace,
} from "./workspace-service";
import { getWorkspace } from "../stores/workspaces";
import { makePersistScheduler } from "../utils/persist-scheduler";

// --- NestedWorkspace persistence (debounced save to state.json) ---

const PERSIST_DELAY = 2000;

export async function persistWorkspaces(): Promise<void> {
  const wsList = get(nestedWorkspaces);
  const serialized = wsList.map((ws) => ({
    // Persist the id so `rootRowOrder` (keyed by `{kind, id}`) survives
    // a restart — without this every workspace id regenerates on
    // `createNestedWorkspaceFromDef` and any user-dragged order is lost.
    id: ws.id,
    name: ws.name,
    cwd: undefined as string | undefined,
    layout: serializeLayout(ws.splitRoot),
    ...(ws.metadata ? { metadata: ws.metadata } : {}),
  }));
  await saveState({
    nestedWorkspaces: serialized,
    activeNestedWorkspaceIdx: get(activeNestedWorkspaceIdx),
  });
}

const _scheduler = makePersistScheduler(persistWorkspaces, PERSIST_DELAY);
export const schedulePersist = _scheduler.schedulePersist;

export async function createNestedWorkspace(name: string) {
  const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
  const ws: NestedWorkspace = {
    id: uid(),
    name,
    splitRoot: { type: "pane", pane },
    activePaneId: pane.id,
  };

  const surface = await createTerminalSurface(pane);

  nestedWorkspaces.update((list) => [...list, ws]);
  // Add to the root-row list. If an extension handler for
  // workspace:created claims this workspace (e.g. project-scope
  // inserting it under a project), claimWorkspace will remove it from
  // the root list — so final state is consistent regardless of
  // handler ordering.
  appendRootRow({ kind: "nested-workspace", id: ws.id });
  eventBus.emit({ type: "workspace:created", id: ws.id, name });
  // Route activation through switchNestedWorkspace so any listener on
  // workspace:activated (e.g. agentic-orchestrator re-spawning a
  // dashboard preview surface, core focus bookkeeping) fires for
  // fresh nestedWorkspaces the same way it would for a user-driven switch.
  switchNestedWorkspace(get(nestedWorkspaces).length - 1);
  void safeFocus(surface);
  schedulePersist();
}

export async function createNestedWorkspaceFromDef(
  def: NestedWorkspaceDef,
  options?: { restoring?: boolean },
): Promise<string> {
  const wsName = def.name || `Workspace ${get(nestedWorkspaces).length + 1}`;
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
            // require user approval before running it unless the parent
            // workspace has autoRunRestoreCommands enabled.
            surface.definedCommand = sDef.command;
            if (restoring) {
              const parentWsId = def.metadata?.parentWorkspaceId;
              const parentWs = parentWsId ? getWorkspace(parentWsId) : null;
              if (parentWs?.autoRunRestoreCommands) {
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

  let splitRoot: SplitNode;
  if (def.layout) {
    splitRoot = await buildTree(def.layout, rootCwd, rootEnv);
  } else {
    const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
    await createTerminalSurface(pane, rootCwd, rootEnv);
    splitRoot = { type: "pane", pane };
  }

  const ws: NestedWorkspace = {
    // Reuse the persisted id when restoring so rootRowOrder survives
    // a restart; mint a fresh one for first-launch creation.
    id: def.id ?? uid(),
    name: wsName,
    splitRoot,
    activePaneId: getAllPanes(splitRoot)[0]?.id ?? null,
    ...(def.metadata ? { metadata: def.metadata } : {}),
  };

  nestedWorkspaces.update((list) => [...list, ws]);
  appendRootRow({ kind: "nested-workspace", id: ws.id });
  eventBus.emit({
    type: "workspace:created",
    id: ws.id,
    name: wsName,
    ...(ws.metadata ? { metadata: ws.metadata } : {}),
  });
  // Route through switchNestedWorkspace so workspace:activated listeners
  // (e.g. agentic-orchestrator's dashboard workspace re-spawn hook)
  // fire on creation — auto-switching to the fresh workspace matches
  // the user-driven switch path. Session restore skips the auto-switch
  // because it'll restore the persisted active idx once every workspace
  // has been rebuilt, and we don't want N+1 activation events along
  // the way.
  if (!restoring) {
    switchNestedWorkspace(get(nestedWorkspaces).length - 1);
  } else {
    activeNestedWorkspaceIdx.set(get(nestedWorkspaces).length - 1);
  }
  const ap = getAllPanes(splitRoot).find((p) => p.id === ws.activePaneId);
  const as_ = ap?.surfaces.find((s) => s.id === ap.activeSurfaceId);
  void safeFocus(as_);
  schedulePersist();
  return ws.id;
}

export function switchNestedWorkspace(idx: number) {
  const wsList = get(nestedWorkspaces);
  if (idx < 0 || idx >= wsList.length) return;
  const previousId =
    get(activeNestedWorkspaceIdx) >= 0
      ? (wsList[get(activeNestedWorkspaceIdx)]?.id ?? null)
      : null;
  activePseudoWorkspaceId.set(null);
  zoomedSurfaceId.set(null);
  activeNestedWorkspaceIdx.set(idx);
  // Record the last-active nested workspace on the parent umbrella workspace
  // so activateWorkspace can restore it on the next switch.
  const ws = wsList[idx];
  const parentWsId = ws?.metadata?.parentWorkspaceId;
  if (parentWsId) {
    updateWorkspace(parentWsId, { lastActiveNestedWorkspaceId: ws.id });
  }
  eventBus.emit({
    type: "workspace:activated",
    id: wsList[idx]!.id,
    previousId,
  });
  void safeFocus(get(activeSurface));
}

export function closeNestedWorkspace(idx: number) {
  const wsList = get(nestedWorkspaces);
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

  for (const pane of getAllPanes(ws.splitRoot)) {
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
  nestedWorkspaces.update((list) => list.filter((_, i) => i !== idx));
  activeNestedWorkspaceIdx.set(
    Math.min(get(activeNestedWorkspaceIdx), get(nestedWorkspaces).length - 1),
  );
  removeRootRow({ kind: "nested-workspace", id: wsId });
  eventBus.emit({ type: "workspace:closed", id: wsId });
  schedulePersist();
}

export function renameNestedWorkspace(idx: number, name: string) {
  const oldName = get(nestedWorkspaces)[idx]?.name ?? "";
  const id = get(nestedWorkspaces)[idx]?.id ?? "";
  nestedWorkspaces.update((list) => {
    list[idx]!.name = name;
    return [...list];
  });
  eventBus.emit({ type: "workspace:renamed", id, oldName, newName: name });
  schedulePersist();
}

/**
 * Toggle the `locked` flag on a workspace's metadata. Locked nestedWorkspaces
 * have their drag-reorder and close affordances suppressed in the UI.
 * No-op if no workspace with the given id exists.
 */
export function toggleWorkspaceLock(workspaceId: string): void {
  let changed = false;
  nestedWorkspaces.update((list) =>
    list.map((ws) => {
      if (ws.id !== workspaceId) return ws;
      changed = true;
      const nextLocked = !ws.metadata?.locked;
      return {
        ...ws,
        metadata: { ...ws.metadata, locked: nextLocked },
      };
    }),
  );
  if (changed) schedulePersist();
}

export function reorderWorkspaces(fromIdx: number, toIdx: number) {
  const activeId = get(nestedWorkspaces)[get(activeNestedWorkspaceIdx)]?.id;
  nestedWorkspaces.update((list) => {
    const item = list.splice(fromIdx, 1)[0]!;
    const adjustedTo = fromIdx < toIdx ? toIdx - 1 : toIdx;
    list.splice(adjustedTo, 0, item);
    return [...list];
  });
  if (activeId) {
    const newIdx = get(nestedWorkspaces).findIndex((ws) => ws.id === activeId);
    if (newIdx >= 0) activeNestedWorkspaceIdx.set(newIdx);
  }
  schedulePersist();
}

export function serializeLayout(node: SplitNode): LayoutNode {
  if (node.type === "pane") {
    const surfaces = node.pane.surfaces.map((s) => {
      if (isTerminalSurface(s)) {
        const def: Record<string, unknown> = { type: "terminal" };
        if (s.cwd) def.cwd = s.cwd;
        if (s.definedCommand) def.command = s.definedCommand;
        if (s.id === node.pane.activeSurfaceId) def.focus = true;
        return def;
      }
      if (isPreviewSurface(s)) {
        const def: Record<string, unknown> = { type: "preview", path: s.path };
        if (s.title) def.name = s.title;
        if (s.id === node.pane.activeSurfaceId) def.focus = true;
        return def;
      }
      // Extension surface
      const def: Record<string, unknown> = { type: "extension" };
      if (s.title) def.name = s.title;
      if (s.id === node.pane.activeSurfaceId) def.focus = true;
      if (isExtensionSurface(s)) {
        def.extensionType = s.surfaceTypeId;
        if (s.props) {
          // Strip non-serializable runtime values (DOM nodes, watch handles)
          const {
            element: _element,
            watchId: _watchId,
            ...serializableProps
          } = s.props as Record<string, unknown>;
          if (Object.keys(serializableProps).length > 0) {
            def.extensionProps = serializableProps;
          }
        }
      }
      return def;
    });
    return { pane: { surfaces } };
  }
  return {
    direction: node.direction,
    split: node.ratio,
    children: [
      serializeLayout(node.children[0]),
      serializeLayout(node.children[1]),
    ],
  };
}

export async function saveCurrentWorkspace() {
  const ws = get(activeWorkspace);
  if (!ws) return;
  const surface = get(activeSurface);
  const name = await showInputPrompt("Workspace name", ws.name);
  if (!name) return;
  const layout = serializeLayout(ws.splitRoot);
  const activeCwd =
    surface && isTerminalSurface(surface) ? surface.cwd : undefined;
  const wsDef: NestedWorkspaceDef = { name, cwd: activeCwd || "~", layout };
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
  const count = get(nestedWorkspaces).length;
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
  // closeNestedWorkspace mutates the store and shifts indices, so always pop
  // index 0 until the list is empty.
  while (get(nestedWorkspaces).length > 0) {
    closeNestedWorkspace(0);
  }
}

/**
 * Collapse an empty pane out of a workspace's split tree. Mirrors the
 * structural piece of `removePane` (in pane-service) without the
 * resize-observer / event-bus / focus side-effects — used by tab-drag
 * services after they move a surface out of a pane that becomes empty.
 *
 * Caller must guarantee `paneId` is NOT the splitRoot pane (a single
 * empty pane at the root has no sibling to collapse into and is the
 * caller's responsibility to handle).
 */
function collapseEmptyPaneInWorkspace(
  ws: NestedWorkspace,
  paneId: string,
): void {
  const parentInfo = findParentSplit(ws.splitRoot, paneId);
  if (!parentInfo || parentInfo.parent.type !== "split") return;
  const sibling = parentInfo.parent.children[parentInfo.index === 0 ? 1 : 0]!;
  if (ws.splitRoot === parentInfo.parent) {
    ws.splitRoot = sibling;
  } else {
    replaceNodeInTree(ws.splitRoot, parentInfo.parent, sibling);
  }
}

/**
 * Spawn a new nested workspace whose splitRoot is a single pane carrying the
 * dragged surface. Inherits the source nested workspace's parentWorkspaceId
 * so a tab dropped from a nested-workspace inside a workspace lands as a
 * sibling within the same parent workspace.
 *
 * Refuses to leave the source empty: when the source workspace has only
 * one surface total, this is a no-op (the caller — tab-drag — also
 * guards against this when computing the drop target, but the service
 * enforces the invariant in case callers skip the check).
 */
export function createNestedWorkspaceFromSurface(
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
  const allWs = get(nestedWorkspaces);
  const srcWs = allWs.find((w) => w.id === sourceWorkspaceId);
  if (!srcWs) return;
  if (getAllSurfaces(srcWs).length < 2) return;

  const sourcePane = getAllPanes(srcWs.splitRoot).find(
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
      srcWs.splitRoot.type === "pane" &&
      srcWs.splitRoot.pane.id === sourcePaneId
    )
  ) {
    collapseEmptyPaneInWorkspace(srcWs, sourcePaneId);
  }

  const newPane: Pane = {
    id: uid(),
    surfaces: [surface],
    activeSurfaceId: surface.id,
  };
  const srcWorkspaceId = srcWs?.metadata?.parentWorkspaceId;
  const effectiveWorkspaceId =
    (insertOptions?.kind === "workspace" && insertOptions.targetWorkspaceId) ||
    srcWorkspaceId;
  const newWs: NestedWorkspace = {
    id: uid(),
    name: surface.title || "New Workspace",
    splitRoot: { type: "pane", pane: newPane },
    activePaneId: newPane.id,
    ...(effectiveWorkspaceId
      ? { metadata: { parentWorkspaceId: effectiveWorkspaceId } }
      : {}),
  };

  nestedWorkspaces.update((list) => [...list, newWs]);
  if (insertOptions?.kind === "root") {
    insertRootRow(insertOptions.insertIdx, {
      kind: "nested-workspace",
      id: newWs.id,
    });
  } else {
    appendRootRow({ kind: "nested-workspace", id: newWs.id });
  }
  if (effectiveWorkspaceId) {
    if (insertOptions?.kind === "workspace") {
      insertNestedWorkspaceIntoWorkspace(
        effectiveWorkspaceId,
        newWs.id,
        insertOptions.positionInWorkspace,
      );
    } else {
      addNestedWorkspaceToWorkspace(effectiveWorkspaceId, newWs.id);
    }
  }
  schedulePersist();
}

// Re-exported so pane-service (which lives next to it) can collapse a
// pane after moving a surface across nestedWorkspaces without duplicating
// the helper.
export { collapseEmptyPaneInWorkspace };

// Derived store: one flat Map<workspaceId, Surface[]> rebuilt per workspace
// update. WorkspaceItem rows still re-run their reactive statement on every
// nestedWorkspaces emission, but each pays only a Map.get() O(1) lookup instead of
// calling getAllSurfaces independently — O(W×S) once vs O(R×W×S) before.
export const workspaceSurfaceMap: Readable<
  Map<string, ReturnType<typeof getAllSurfaces>>
> = derived(nestedWorkspaces, ($ws) => {
  const m = new Map<string, ReturnType<typeof getAllSurfaces>>();
  for (const ws of $ws) m.set(ws.id, getAllSurfaces(ws));
  return m;
});
