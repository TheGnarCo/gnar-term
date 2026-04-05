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

export function isPreviewSurface(s: Surface): s is PreviewSurface {
  return s.kind === "preview";
}
