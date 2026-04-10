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
import { openPreview } from "../../preview/index";
import {
  uid,
  getAllPanes,
  getAllSurfaces,
  isTerminalSurface,
  isExtensionSurface,
  type Workspace,
  type Pane,
  type SplitNode,
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

// --- Workspace persistence (debounced save to state.json) ---

let persistTimer: ReturnType<typeof setTimeout> | null = null;
const PERSIST_DELAY = 2000;

export function persistWorkspaces(): void {
  const wsList = get(workspaces);
  const serialized = wsList.map((ws) => ({
    name: ws.name,
    cwd: undefined as string | undefined,
    layout: serializeLayout(ws.splitRoot),
  }));
  saveState({
    workspaces: serialized,
    activeWorkspaceIdx: get(activeWorkspaceIdx),
  }).catch((err) => {
    console.error("[workspace-service] Failed to persist workspaces:", err);
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
  activeWorkspaceIdx.set(get(workspaces).length - 1);
  eventBus.emit({ type: "workspace:created", id: ws.id, name });
  safeFocus(surface);
  schedulePersist();
}

export async function createWorkspaceFromDef(def: WorkspaceDef) {
  const wsName = def.name || `Workspace ${get(workspaces).length + 1}`;
  const rootCwd = def.cwd;

  async function buildTree(
    nodeDef: LayoutNode,
    inheritedCwd?: string,
  ): Promise<SplitNode> {
    if ("pane" in nodeDef) {
      const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
      for (const sDef of nodeDef.pane.surfaces) {
        const cwd = sDef.cwd || inheritedCwd;
        if (sDef.type === "markdown" && sDef.path) {
          // Legacy markdown type — maps to preview extension
          const preview = await openPreview(sDef.path);
          const surface = {
            kind: "extension" as const,
            id: preview.id,
            surfaceTypeId: "preview:preview",
            title: sDef.name || preview.title,
            hasUnread: false,
            props: {
              filePath: preview.filePath,
            },
          };
          pane.surfaces.push(surface);
          if (!pane.activeSurfaceId || sDef.focus)
            pane.activeSurfaceId = surface.id;
        } else if (sDef.type === "extension" && sDef.extensionType) {
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
        } else {
          const surface = await createTerminalSurface(pane, cwd);
          if (sDef.name) surface.title = sDef.name;
          if (sDef.command) surface.startupCommand = sDef.command;
          if (sDef.focus) pane.activeSurfaceId = surface.id;
        }
      }
      if (pane.surfaces.length === 0) {
        await createTerminalSurface(pane, inheritedCwd);
      }
      return { type: "pane", pane };
    } else {
      const left = await buildTree(nodeDef.children[0], inheritedCwd);
      const right = await buildTree(nodeDef.children[1], inheritedCwd);
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
    splitRoot = await buildTree(def.layout, rootCwd);
  } else {
    const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
    await createTerminalSurface(pane, rootCwd);
    splitRoot = { type: "pane", pane };
  }

  const ws: Workspace = {
    id: uid(),
    name: wsName,
    splitRoot,
    activePaneId: getAllPanes(splitRoot)[0]?.id ?? null,
  };

  workspaces.update((list) => [...list, ws]);
  activeWorkspaceIdx.set(get(workspaces).length - 1);
  eventBus.emit({ type: "workspace:created", id: ws.id, name: wsName });
  const ap = getAllPanes(splitRoot).find((p) => p.id === ws.activePaneId);
  const as_ = ap?.surfaces.find((s) => s.id === ap.activeSurfaceId);
  safeFocus(as_);
  schedulePersist();
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
    id: wsList[idx].id,
    previousId,
  });
  safeFocus(get(activeSurface));
}

export function closeWorkspace(idx: number) {
  const wsList = get(workspaces);
  if (wsList.length <= 1) return;
  const ws = wsList[idx];
  for (const pane of getAllPanes(ws.splitRoot)) {
    pane.resizeObserver?.disconnect();
  }
  for (const s of getAllSurfaces(ws)) {
    if (isTerminalSurface(s)) {
      s.terminal.dispose();
      if (s.ptyId >= 0) {
        invoke("kill_pty", { ptyId: s.ptyId }).catch(() => {});
      }
    }
  }
  const wsId = ws.id;
  workspaces.update((list) => list.filter((_, i) => i !== idx));
  activeWorkspaceIdx.set(
    Math.min(get(activeWorkspaceIdx), get(workspaces).length - 1),
  );
  eventBus.emit({ type: "workspace:closed", id: wsId });
  schedulePersist();
}

export function renameWorkspace(idx: number, name: string) {
  const oldName = get(workspaces)[idx]?.name ?? "";
  const id = get(workspaces)[idx]?.id ?? "";
  workspaces.update((list) => {
    list[idx].name = name;
    return [...list];
  });
  eventBus.emit({ type: "workspace:renamed", id, oldName, newName: name });
  schedulePersist();
}

export function reorderWorkspaces(fromIdx: number, toIdx: number) {
  const activeId = get(workspaces)[get(activeWorkspaceIdx)]?.id;
  workspaces.update((list) => {
    const item = list.splice(fromIdx, 1)[0];
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
