import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { SearchAddon } from "@xterm/addon-search";

let _id = 0;
export function uid(): string {
  return `id-${++_id}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Unified Workspace type hierarchy
// ---------------------------------------------------------------------------

/**
 * Base: every workspace has its own pane layout + optional project-level fields.
 * Primary/standalone workspaces carry `path`, `color`, `isGit`, `createdAt`.
 * Child workspaces (branched + dashboards) are identified by `parentWorkspaceId`.
 */
export interface Workspace {
  id: string;
  name: string;
  splitRoot: SplitNode;
  activePaneId: string | null;
  // Project-level (present on primary/standalone workspaces, absent on children)
  path?: string;
  color?: string;
  isGit?: boolean;
  createdAt?: string;
  // Child workspaces navigation
  lastActiveBranchedWorkspaceId?: string;
  // Dashboard back-reference
  dashboardWorkspaceId?: string;
  // Flags
  locked?: boolean;
  pathMissing?: boolean; // runtime-only, not persisted
  autoRunRestoreCommands?: boolean;
  // Dashboard flag — present on child workspaces that are overview dashboards
  isDashboard?: boolean;
  dashboardContributionId?: string;
  // Extension data — replaces open-ended metadata index signature
  extensionData?: Record<string, unknown>;
  // Parent reference — presence discriminates child workspaces from primary workspaces
  parentWorkspaceId?: string;
  /**
   * Transitional: legacy metadata blob carried over from the
   * pre-unification store. New writers should set top-level fields and
   * `extensionData` instead. Read access goes through `wsMeta()` which
   * unifies this with `extensionData`. Removed once all writers migrate.
   */
  metadata?: WorkspaceMetadata;
}

/**
 * Extension: branched workspaces add a parent link + worktree fields.
 * `parentWorkspaceId` is the discriminant — its presence means "branched workspace".
 */
export interface BranchedWorkspace extends Workspace {
  parentWorkspaceId: string;
  worktreePath: string;
  branch: string;
  baseBranch?: string;
  repoPath?: string;
}

/** Type guard: returns true when `ws` is a BranchedWorkspace. */
export function isBranchedWorkspace(ws: Workspace): ws is BranchedWorkspace {
  return (
    typeof (ws as BranchedWorkspace).parentWorkspaceId === "string" &&
    typeof (ws as BranchedWorkspace).worktreePath === "string"
  );
}

/** True when ws is a child workspace (branched or dashboard). */
export function isChildWorkspace(ws: Workspace): boolean {
  return isBranchedWorkspace(ws) || ws.isDashboard === true;
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
  /**
   * Title set explicitly by the user via `renameSurface` (the
   * Rename Surface command). When present, OSC 0/2 (window title) and
   * OSC 7 (cwd) escape sequences will not overwrite `title`, and
   * `detachAgent` prefers it over the captured `preAgentTitle`. Runtime
   * only — not currently persisted across app restart.
   */
  userDefinedTitle?: string;
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
  exitedSurface?: { code: number; definedCommand?: string; cwd?: string };
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
 * Typed metadata carried by a Workspace. All known keys are optional.
 * The index signature preserves compatibility with extension-API sites that
 * accept Record<string,unknown> and with serialised state that may carry
 * legacy or unknown keys.
 */
export interface WorkspaceMetadata {
  // --- Index signature: extensions may store arbitrary keys ---
  [key: string]: unknown;
  // --- Worktree fields ---
  /** Set on branched workspaces; absolute path to the worktree directory. */
  worktreePath?: string;
  /** Git branch name for branched workspaces. */
  branch?: string;
  /** Base branch the worktree was created from. */
  baseBranch?: string;
  /** Absolute path to the source repo for branched workspaces. */
  repoPath?: string;
  // --- Project-scope extension ---
  /** Project id used by the project-scope extension to claim the workspace. */
  projectId?: string;
  // --- Dashboard / workspace fields ---
  /** Marks a workspace as a dashboard (used by workspace-service and related services). */
  isDashboard?: boolean;
  /** Parent workspace id this workspace belongs to (workspace-service). */
  parentWorkspaceId?: string;
  /** Id of the parent workspace's current dashboard child workspace (workspace-service). */
  dashboardWorkspaceId?: string;
  /**
   * Contribution id for the dashboard type: "group" | "agentic" | "settings" | string.
   * Backfilled by workspace-service for legacy workspaces. The "group"
   * literal is the stable contribution id for the parent-workspace overview.
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
  spawnedBy?:
    | { kind: "global" }
    | { kind: "workspace"; parentWorkspaceId: string };
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

// Helper functions for tree traversal
export function getAllPanes(node: SplitNode): Pane[] {
  if (node.type === "pane") return [node.pane];
  return [...getAllPanes(node.children[0]), ...getAllPanes(node.children[1])];
}

export function getAllSurfaces(ws: { splitRoot: SplitNode }): Surface[] {
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
