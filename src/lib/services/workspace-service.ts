import { get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import {
  workspaces,
  activeWorkspaceIdx,
  activeWorkspace,
  activeSurface,
} from "../stores/workspace";
import { showInputPrompt } from "../stores/ui";
import { createTerminalSurface } from "../terminal-service";
import {
  uid,
  getAllPanes,
  getAllSurfaces,
  isTerminalSurface,
  isExtensionSurface,
  isPreviewSurface,
  type Workspace,
  type Pane,
  type SplitNode,
  type PreviewSurface,
} from "../types";
import {
  saveConfig,
  saveState,
  getConfig,
  type WorkspaceDef,
  type LayoutNode,
} from "../config";
import { safeFocus } from "./service-helpers";
import { eventBus } from "./event-bus";
import { appendRootRow, removeRootRow } from "../stores/root-row-order";

// --- Workspace persistence (debounced save to state.json) ---

let persistTimer: ReturnType<typeof setTimeout> | null = null;
const PERSIST_DELAY = 2000;

export async function persistWorkspaces(): Promise<void> {
  const wsList = get(workspaces);
  const serialized = wsList.map((ws) => ({
    name: ws.name,
    cwd: undefined as string | undefined,
    layout: serializeLayout(ws.splitRoot),
    ...(ws.metadata ? { metadata: ws.metadata } : {}),
  }));
  await saveState({
    workspaces: serialized,
    activeWorkspaceIdx: get(activeWorkspaceIdx),
  });
}

export function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(persistWorkspaces, PERSIST_DELAY);
}

export async function createWorkspace(name: string) {
  const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
  const ws: Workspace = {
    id: uid(),
    name,
    splitRoot: { type: "pane", pane },
    activePaneId: pane.id,
  };

  const surface = await createTerminalSurface(pane);

  workspaces.update((list) => [...list, ws]);
  // Add to the root-row list. If an extension handler for
  // workspace:created claims this workspace (e.g. project-scope
  // inserting it under a project), claimWorkspace will remove it from
  // the root list — so final state is consistent regardless of
  // handler ordering.
  appendRootRow({ kind: "workspace", id: ws.id });
  eventBus.emit({ type: "workspace:created", id: ws.id, name });
  // Route activation through switchWorkspace so any listener on
  // workspace:activated (e.g. agentic-orchestrator re-spawning a
  // dashboard preview surface, core focus bookkeeping) fires for
  // fresh workspaces the same way it would for a user-driven switch.
  switchWorkspace(get(workspaces).length - 1);
  void safeFocus(surface);
  schedulePersist();
}

export async function createWorkspaceFromDef(
  def: WorkspaceDef,
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
            // require user approval before running it, so we do NOT set
            // startupCommand. Fresh creation runs the command immediately.
            surface.definedCommand = sDef.command;
            if (restoring) {
              surface.pendingRestoreCommand = true;
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

  const ws: Workspace = {
    id: uid(),
    name: wsName,
    splitRoot,
    activePaneId: getAllPanes(splitRoot)[0]?.id ?? null,
    ...(def.metadata ? { metadata: def.metadata } : {}),
  };

  workspaces.update((list) => [...list, ws]);
  appendRootRow({ kind: "workspace", id: ws.id });
  eventBus.emit({
    type: "workspace:created",
    id: ws.id,
    name: wsName,
    ...(ws.metadata ? { metadata: ws.metadata } : {}),
  });
  // Route through switchWorkspace so workspace:activated listeners
  // (e.g. agentic-orchestrator's dashboard workspace re-spawn hook)
  // fire on creation — auto-switching to the fresh workspace matches
  // the user-driven switch path. Session restore skips the auto-switch
  // because it'll restore the persisted active idx once every workspace
  // has been rebuilt, and we don't want N+1 activation events along
  // the way.
  if (!restoring) {
    switchWorkspace(get(workspaces).length - 1);
  } else {
    activeWorkspaceIdx.set(get(workspaces).length - 1);
  }
  const ap = getAllPanes(splitRoot).find((p) => p.id === ws.activePaneId);
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
  activeWorkspaceIdx.set(idx);
  eventBus.emit({
    type: "workspace:activated",
    id: wsList[idx]!.id,
    previousId,
  });
  void safeFocus(get(activeSurface));
}

export function closeWorkspace(idx: number) {
  const wsList = get(workspaces);
  const ws = wsList[idx];
  if (!ws) return;
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
  const wsId = ws.id;
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

export function serializeLayout(node: SplitNode): LayoutNode {
  if (node.type === "pane") {
    const surfaces = node.pane.surfaces.map((s) => {
      if (isTerminalSurface(s)) {
        const def: Record<string, unknown> = { type: "terminal" };
        if (s.title) def.name = s.title;
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
  const wsDef: WorkspaceDef = { name, cwd: activeCwd || "~", layout };
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
