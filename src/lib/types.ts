import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { SearchAddon } from "@xterm/addon-search";

let _id = 0;
export function uid(): string { return `id-${++_id}-${Date.now()}`; }

export interface TerminalSurface {
  kind: "terminal";
  id: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  termElement: HTMLElement;
  ptyId: number;
  title: string;
  cwd?: string;
  notification?: string;
  hasUnread: boolean;
  opened: boolean;
  startupCommand?: string;
}

export interface PreviewSurface {
  kind: "preview";
  id: string;
  filePath: string;
  title: string;
  element: HTMLElement;
  watchId: number;
  hasUnread: boolean;
  dispose?: () => void;
}

export type Surface = TerminalSurface | PreviewSurface;

export interface Pane {
  id: string;
  surfaces: Surface[];
  activeSurfaceId: string | null;
  resizeObserver?: ResizeObserver;
  element?: HTMLElement;
}

export type SplitNode =
  | { type: "pane"; pane: Pane }
  | { type: "split"; direction: "horizontal" | "vertical"; children: [SplitNode, SplitNode]; ratio: number };

export interface Workspace {
  id: string;
  name: string;
  splitRoot: SplitNode;
  activePaneId: string | null;
}

// Helper functions for tree traversal
export function getAllPanes(node: SplitNode): Pane[] {
  if (node.type === "pane") return [node.pane];
  return [...getAllPanes(node.children[0]), ...getAllPanes(node.children[1])];
}

export function getAllSurfaces(ws: Workspace): Surface[] {
  return getAllPanes(ws.splitRoot).flatMap(p => p.surfaces);
}

export function isTerminalSurface(s: Surface): s is TerminalSurface {
  return s.kind === "terminal";
}

/**
 * Find a pane by id within a single workspace's split tree.
 * Returns undefined when no pane in the workspace has that id.
 */
export function findPaneInWorkspace(ws: Workspace, paneId: string): Pane | undefined {
  return getAllPanes(ws.splitRoot).find((p) => p.id === paneId);
}

/**
 * Find a pane by id across all of the given workspaces, returning both the
 * pane and the workspace that contains it. Returns null when no workspace
 * contains a pane with that id (e.g. the pane was closed, or the id is invalid).
 */
export function findPaneById(
  wsList: Workspace[],
  paneId: string,
): { workspace: Workspace; pane: Pane } | null {
  for (const ws of wsList) {
    const pane = findPaneInWorkspace(ws, paneId);
    if (pane) return { workspace: ws, pane };
  }
  return null;
}

/**
 * Find the pane that contains a surface with the given id, searching a single
 * workspace's split tree. Returns undefined when no pane holds that surface.
 */
export function findPaneContainingSurface(
  ws: Workspace,
  surfaceId: string,
): Pane | undefined {
  return getAllPanes(ws.splitRoot).find((p) =>
    p.surfaces.some((s) => s.id === surfaceId),
  );
}

/**
 * Find a terminal surface by its PTY id across all of the given workspaces.
 * Only terminal surfaces carry a ptyId, so preview surfaces are skipped.
 * Returns null when no live terminal surface owns that ptyId.
 *
 * This is a linear scan by design — a stateful ptyId→surface index would risk
 * desyncing from the workspace tree on splits/closes/moves.
 */
export function findSurfaceByPtyId(
  wsList: Workspace[],
  ptyId: number,
): TerminalSurface | null {
  for (const ws of wsList) {
    for (const s of getAllSurfaces(ws)) {
      if (isTerminalSurface(s) && s.ptyId === ptyId) return s;
    }
  }
  return null;
}

export function isPreviewSurface(s: Surface): s is PreviewSurface {
  return s.kind === "preview";
}

/** True if `surfaceId` lives anywhere in the subtree rooted at `node`. */
export function nodeContainsSurface(node: SplitNode, surfaceId: string): boolean {
  if (node.type === "pane") return node.pane.surfaces.some((s) => s.id === surfaceId);
  return (
    nodeContainsSurface(node.children[0], surfaceId) ||
    nodeContainsSurface(node.children[1], surfaceId)
  );
}

/** Find the parent split node containing a pane with the given ID. */
export function findParentSplit(node: SplitNode, paneId: string): { parent: SplitNode; index: number } | null {
  if (node.type === "pane") return null;
  if (node.children[0].type === "pane" && node.children[0].pane.id === paneId) return { parent: node, index: 0 };
  if (node.children[1].type === "pane" && node.children[1].pane.id === paneId) return { parent: node, index: 1 };
  return findParentSplit(node.children[0], paneId) || findParentSplit(node.children[1], paneId);
}

/** Replace a target node in the split tree with a replacement. Returns true if found. */
export function replaceNodeInTree(root: SplitNode, target: SplitNode, replacement: SplitNode): boolean {
  if (root.type === "pane") return false;
  if (root.children[0] === target) { root.children[0] = replacement; return true; }
  if (root.children[1] === target) { root.children[1] = replacement; return true; }
  return replaceNodeInTree(root.children[0], target, replacement) || replaceNodeInTree(root.children[1], target, replacement);
}
