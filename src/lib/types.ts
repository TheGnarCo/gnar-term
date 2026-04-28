import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { SearchAddon } from "@xterm/addon-search";

let _id = 0;
export function uid(): string {
  return `id-${++_id}-${Date.now()}`;
}

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
  env?: Record<string, string>;
  notification?: string;
  hasUnread: boolean;
  opened: boolean;
  startupCommand?: string;
  // Persistent record of the command this pane was originally created with.
  // Survives restore so we can re-prompt across sessions if the user defers.
  definedCommand?: string;
  // True only on a restored surface whose definedCommand has not yet been
  // approved or dismissed. Drives both the bulk dialog and the inline banner.
  pendingRestoreCommand?: boolean;
  // Set by connectPty on spawn failure; consumed by TerminalSurface.svelte to
  // show an error message and remove the dead surface from its pane.
  spawnError?: string;
}

export interface ExtensionSurface {
  kind: "extension";
  id: string;
  surfaceTypeId: string; // maps to SurfaceTypeDef.id in the registry
  title: string;
  hasUnread: boolean;
  notification?: string;
  props?: Record<string, unknown>; // arbitrary data passed to the extension component
  dispose?: () => void;
}

export interface PreviewSurface {
  kind: "preview";
  id: string;
  title: string;
  // Absolute path to the backing file. The file is the persistent identity
  // of a preview surface — open previews are deduped by path (e.g. by
  // openDashboard), and the path round-trips through workspace persistence.
  path: string;
  hasUnread: boolean;
  notification?: string;
}

export type Surface = TerminalSurface | ExtensionSurface | PreviewSurface;

export interface Pane {
  id: string;
  surfaces: Surface[];
  activeSurfaceId: string | null;
  resizeObserver?: ResizeObserver;
  element?: HTMLElement;
}

export type SplitNode =
  | { type: "pane"; pane: Pane }
  | {
      type: "split";
      direction: "horizontal" | "vertical";
      children: [SplitNode, SplitNode];
      ratio: number;
    };

export interface Workspace {
  id: string;
  name: string;
  splitRoot: SplitNode;
  activePaneId: string | null;
  metadata?: Record<string, unknown>;
}

// Helper functions for tree traversal
export function getAllPanes(node: SplitNode): Pane[] {
  if (node.type === "pane") return [node.pane];
  return [...getAllPanes(node.children[0]), ...getAllPanes(node.children[1])];
}

export function getAllSurfaces(ws: Workspace): Surface[] {
  return getAllPanes(ws.splitRoot).flatMap((p) => p.surfaces);
}

export function isTerminalSurface(s: Surface): s is TerminalSurface {
  return s.kind === "terminal";
}

export function isExtensionSurface(s: Surface): s is ExtensionSurface {
  return s.kind === "extension";
}

export function isPreviewSurface(s: Surface): s is PreviewSurface {
  return s.kind === "preview";
}

/** Find the parent split node containing a pane with the given ID. */
export function findParentSplit(
  node: SplitNode,
  paneId: string,
): { parent: SplitNode; index: number } | null {
  if (node.type === "pane") return null;
  if (node.children[0].type === "pane" && node.children[0].pane.id === paneId)
    return { parent: node, index: 0 };
  if (node.children[1].type === "pane" && node.children[1].pane.id === paneId)
    return { parent: node, index: 1 };
  return (
    findParentSplit(node.children[0], paneId) ||
    findParentSplit(node.children[1], paneId)
  );
}

/** Replace a target node in the split tree with a replacement. Returns true if found. */
export function replaceNodeInTree(
  root: SplitNode,
  target: SplitNode,
  replacement: SplitNode,
): boolean {
  if (root.type === "pane") return false;
  if (root.children[0] === target) {
    root.children[0] = replacement;
    return true;
  }
  if (root.children[1] === target) {
    root.children[1] = replacement;
    return true;
  }
  return (
    replaceNodeInTree(root.children[0], target, replacement) ||
    replaceNodeInTree(root.children[1], target, replacement)
  );
}
