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

/**
 * Typed metadata carried by a NestedWorkspace. All known keys are optional.
 * The index signature preserves compatibility with extension-API sites that
 * accept Record<string,unknown> and with serialised state that may carry
 * legacy or unknown keys.
 */
export interface NestedWorkspaceMetadata {
  // --- Index signature: extensions may store arbitrary keys ---
  [key: string]: unknown;
  // --- Worktree fields ---
  /** Set on worktree-backed nestedWorkspaces; absolute path to the worktree directory. */
  worktreePath?: string;
  /** Git branch name for worktree nestedWorkspaces. */
  branch?: string;
  /** Base branch the worktree was created from. */
  baseBranch?: string;
  /** Absolute path to the source repo for worktree nestedWorkspaces. */
  repoPath?: string;
  // --- Project-scope extension ---
  /** Project id used by the project-scope extension to claim the workspace. */
  projectId?: string;
  // --- Dashboard / group fields ---
  /** Marks a workspace as a dashboard (used by workspace-group and related services). */
  isDashboard?: boolean;
  /** Group id this workspace belongs to (workspace-group-service). */
  parentWorkspaceId?: string;
  /** Id of the group's current dashboard workspace (workspace-group-service). */
  dashboardNestedWorkspaceId?: string;
  /**
   * Contribution id for the dashboard type: "group" | "agentic" | "settings" | string.
   * Backfilled by workspace-group-service for legacy nestedWorkspaces.
   */
  dashboardContributionId?: string;
  /** True on the global agentic pseudo-workspace (agentic-orchestrator). */
  isGlobalAgenticDashboard?: boolean;
  // --- Agentic orchestrator / spawn-helper ---
  /** Id of the dashboard workspace that spawned this workspace. */
  parentDashboardId?: string;
  /**
   * Provenance marker set by spawn-helper. Records which dashboard spawned
   * this workspace so the sidebar can show a bot-icon affordance.
   */
  spawnedBy?: { kind: "global" } | { kind: "group"; parentWorkspaceId: string };
  /**
   * GitHub issue numbers this workspace is handling (agentic-orchestrator).
   * Written by createWorktreeWorkspaceFromConfig.
   */
  spawnedFromIssues?: number[];
  // --- User locking ---
  /**
   * When true, the workspace is "locked" — it cannot be closed via the
   * Close affordances and is not draggable for reorder. Toggled by the
   * "Lock Workspace" / "Unlock Workspace" context-menu item.
   */
  locked?: boolean;
}

export interface NestedWorkspace {
  id: string;
  name: string;
  splitRoot: SplitNode;
  activePaneId: string | null;
  metadata?: NestedWorkspaceMetadata;
}

// Helper functions for tree traversal
export function getAllPanes(node: SplitNode): Pane[] {
  if (node.type === "pane") return [node.pane];
  return [...getAllPanes(node.children[0]), ...getAllPanes(node.children[1])];
}

export function getAllSurfaces(ws: NestedWorkspace): Surface[] {
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

/** Return true if any pane within the subtree contains a surface with the given ID. */
export function nodeContainsSurface(
  node: SplitNode,
  surfaceId: string,
): boolean {
  if (node.type === "pane")
    return node.pane.surfaces.some((s) => s.id === surfaceId);
  return (
    nodeContainsSurface(node.children[0], surfaceId) ||
    nodeContainsSurface(node.children[1], surfaceId)
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
