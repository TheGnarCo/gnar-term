import { get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { workspaces, activeWorkspaceIdx, activeWorkspace, activeSurface } from "../stores/workspace";
import { showInputPrompt } from "../stores/ui";
import { createTerminalSurface } from "../terminal-service";
import { openPreview } from "../../preview/index";
import { uid, getAllPanes, getAllSurfaces, isTerminalSurface, type Workspace, type Pane, type SplitNode } from "../types";
import { saveConfig, getConfig, type WorkspaceDef, type LayoutNode } from "../config";
import { safeFocus } from "./service-helpers";

export async function createWorkspace(name: string) {
  const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
  const ws: Workspace = {
    id: uid(), name,
    splitRoot: { type: "pane", pane },
    activePaneId: pane.id,
  };

  const surface = await createTerminalSurface(pane);

  workspaces.update(list => [...list, ws]);
  activeWorkspaceIdx.set(get(workspaces).length - 1);
  safeFocus(surface);
}

export async function createWorkspaceFromDef(def: WorkspaceDef) {
  const wsName = def.name || `Workspace ${get(workspaces).length + 1}`;
  const rootCwd = def.cwd;

  async function buildTree(nodeDef: LayoutNode, inheritedCwd?: string): Promise<SplitNode> {
    if ("pane" in nodeDef) {
      const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
      for (const sDef of nodeDef.pane.surfaces) {
        const cwd = sDef.cwd || inheritedCwd;
        if (sDef.type === "markdown" && sDef.path) {
          const preview = await openPreview(sDef.path);
          const surface = {
            kind: "preview" as const,
            id: preview.id, filePath: preview.filePath,
            title: sDef.name || preview.title,
            element: preview.element, watchId: preview.watchId,
            hasUnread: false,
          };
          pane.surfaces.push(surface);
          if (!pane.activeSurfaceId || sDef.focus) pane.activeSurfaceId = surface.id;
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
      return { type: "split", direction: nodeDef.direction, ratio: nodeDef.split || 0.5, children: [left, right] };
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
    id: uid(), name: wsName, splitRoot,
    activePaneId: getAllPanes(splitRoot)[0]?.id ?? null,
  };

  workspaces.update(list => [...list, ws]);
  activeWorkspaceIdx.set(get(workspaces).length - 1);
  const ap = getAllPanes(splitRoot).find(p => p.id === ws.activePaneId);
  const as_ = ap?.surfaces.find(s => s.id === ap.activeSurfaceId);
  safeFocus(as_);
}

export function switchWorkspace(idx: number) {
  if (idx < 0 || idx >= get(workspaces).length) return;
  activeWorkspaceIdx.set(idx);
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
  workspaces.update(list => list.filter((_, i) => i !== idx));
  activeWorkspaceIdx.set(Math.min(get(activeWorkspaceIdx), get(workspaces).length - 1));
}

export function renameWorkspace(idx: number, name: string) {
  workspaces.update(list => {
    list[idx].name = name;
    return [...list];
  });
}

export function reorderWorkspaces(fromIdx: number, toIdx: number) {
  workspaces.update(list => {
    const item = list.splice(fromIdx, 1)[0];
    const adjustedTo = fromIdx < toIdx ? toIdx - 1 : toIdx;
    list.splice(adjustedTo, 0, item);
    return [...list];
  });
  if (get(activeWorkspaceIdx) === fromIdx) {
    activeWorkspaceIdx.set(fromIdx < toIdx ? toIdx - 1 : toIdx);
  }
}

export function serializeLayout(node: SplitNode): LayoutNode {
  if (node.type === "pane") {
    const surfaces = node.pane.surfaces.map(s => {
      const def: any = { type: isTerminalSurface(s) ? "terminal" : "markdown" };
      if (s.title) def.name = s.title;
      if (isTerminalSurface(s) && s.cwd) def.cwd = s.cwd;
      if (s.id === node.pane.activeSurfaceId) def.focus = true;
      if (!isTerminalSurface(s) && "filePath" in s) def.path = s.filePath;
      return def;
    });
    return { pane: { surfaces } };
  }
  return {
    direction: node.direction,
    split: node.ratio,
    children: [serializeLayout(node.children[0]), serializeLayout(node.children[1])],
  };
}

export async function saveCurrentWorkspace() {
  const ws = get(activeWorkspace);
  if (!ws) return;
  const surface = get(activeSurface);
  const name = await showInputPrompt("Workspace name", ws.name);
  if (!name) return;
  const layout = serializeLayout(ws.splitRoot);
  const activeCwd = surface && isTerminalSurface(surface) ? surface.cwd : undefined;
  const wsDef: WorkspaceDef = { name, cwd: activeCwd || "~", layout };
  const config = getConfig();
  const commands = config.commands || [];
  const existing = commands.findIndex(c => c.name === name);
  const entry = { name, workspace: wsDef };
  if (existing >= 0) {
    commands[existing] = entry;
  } else {
    commands.push(entry);
  }
  await saveConfig({ commands });
}
