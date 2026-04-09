/**
 * GnarTerm Domain Model
 *
 * The UI is organized in a four-level hierarchy:
 *
 *   Workspace  →  The top-level unit of work. Each workspace occupies a tab
 *                 in the workspace tab bar (Cmd+1..9 to switch). A workspace
 *                 can be a "terminal" workspace (ad-hoc shells) or a
 *                 "managed" workspace (tied to a git worktree
 *                 (tied to a git branch + directory).
 *
 *   Pane       →  A rectangular region within a workspace. Panes are arranged
 *                 in a binary split tree (horizontal/vertical). A workspace
 *                 always has at least one pane.
 *
 *   Surface    →  A content view inside a pane. Surfaces are shown as tabs
 *                 in the pane's tab bar (the inner tab bar, not the workspace
 *                 tab bar). A pane can hold multiple surfaces — one is active
 *                 (visible) at a time. Surface kinds:
 *                   - terminal:      interactive PTY shell
 *                   - harness:       AI CLI tool (e.g. Claude Code) in a PTY
 *                   - preview:       file preview (markdown, image, JSON, etc.)
 *                   - diff:          git diff viewer
 *                   - filebrowser:   tracked file listing
 *                   - commithistory: commit log viewer
 *
 *   Tab        →  The clickable chrome element in a tab bar that represents
 *                 a surface. Implemented by Tab.svelte / TabBar.svelte.
 *                 "Tab" is strictly a UI element — the data behind it is a
 *                 Surface.
 *
 * Naming convention: "surface" = the data/content model. "tab" = the UI
 * element that selects a surface. They are 1:1 but kept separate because
 * the tab only needs a title and icon, while the surface holds the full
 * state (terminal instance, PTY handle, DOM element, etc.).
 */

import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { SearchAddon } from "@xterm/addon-search";

let _id = 0;
export function uid(): string {
  return `id-${++_id}-${Date.now()}`;
}

// --- Agent status ---

export type AgentStatus = "idle" | "running" | "waiting" | "error" | "exited";

// --- Surface types (see domain model comment above) ---

/** An interactive shell session backed by a PTY. */
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
  /** Extra env vars for PTY spawn (e.g. GNARTERM_WORKTREE_ROOT). */
  env?: Record<string, string>;
  /** Detected agent status (set when claude/agent detected running in this terminal). */
  agentStatus?: AgentStatus;
}

/** A read-only file preview (markdown, image, JSON, CSV, etc.). */
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

/** An AI CLI tool (e.g. Claude Code) running in its own PTY. */
export interface HarnessSurface {
  kind: "harness";
  id: string;
  presetId: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  termElement: HTMLElement;
  ptyId: number;
  status: AgentStatus;
  title: string;
  cwd?: string;
  notification?: string;
  hasUnread: boolean;
  opened: boolean;
  startupCommand?: string;
  /** Extra env vars for PTY spawn (e.g. GNARTERM_WORKTREE_ROOT). */
  env?: Record<string, string>;
}

export interface DiffSurface {
  kind: "diff";
  id: string;
  title: string;
  worktreePath: string;
  filePath?: string;
  diffContent: string;
  hasUnread: boolean;
}

export interface FileBrowserSurface {
  kind: "filebrowser";
  id: string;
  title: string;
  worktreePath: string;
  files: string[];
  hasUnread: boolean;
}

export interface CommitHistorySurface {
  kind: "commithistory";
  id: string;
  title: string;
  worktreePath: string;
  baseBranch?: string;
  commits: Array<{
    hash: string;
    shortHash: string;
    subject: string;
    author: string;
    date: string;
  }>;
  hasUnread: boolean;
}

/** Placeholder shown when a harness tab is closed, allowing the user to re-launch it. */
export interface HarnessPlaceholderSurface {
  kind: "harness-placeholder";
  id: string;
  title: string;
  presetId: string;
  cwd?: string;
  exitCode?: number;
  hasUnread: boolean;
}

/** Discriminated union of all content views that can live inside a pane. */
export type Surface =
  | TerminalSurface
  | PreviewSurface
  | HarnessSurface
  | DiffSurface
  | FileBrowserSurface
  | CommitHistorySurface
  | HarnessPlaceholderSurface;

// --- Layout ---

/** A rectangular region that holds one or more surfaces (shown as tabs). */
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

// --- Workspace ---

export type WorkspaceType = "terminal" | "managed";
export type WorkspaceStatus = "active" | "stashed" | "archived";

export interface WorkspaceRecord {
  id: string;
  type: WorkspaceType;
  name: string;
  status: WorkspaceStatus;
  createdAt?: number;
  projectId?: string;
  branch?: string;
  baseBranch?: string;
  worktreePath?: string;
}

/** Runtime workspace — a split tree of panes. Shown as a top-level tab. */
export interface Workspace {
  id: string;
  name: string;
  splitRoot: SplitNode;
  activePaneId: string | null;
  /** Persisted metadata (links to a project, branch, worktree path). */
  record?: WorkspaceRecord;
  /** Whether the right sidebar is visible for this workspace (runtime only). */
  rightSidebarOpen?: boolean;
}

// --- Harness preset ---

export interface HarnessPreset {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  icon?: string;
}

// --- Worktree environment helper ---

export function getWorktreeEnv(
  ws: Workspace,
): Record<string, string> | undefined {
  return ws.record?.type === "managed" && ws.record.worktreePath
    ? { GNARTERM_WORKTREE_ROOT: ws.record.worktreePath }
    : undefined;
}

// --- Helper functions for tree traversal ---

export function findPane(ws: Workspace, paneId: string): Pane | null {
  return getAllPanes(ws.splitRoot).find((p) => p.id === paneId) ?? null;
}

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

export function isPreviewSurface(s: Surface): s is PreviewSurface {
  return s.kind === "preview";
}

export function isHarnessSurface(s: Surface): s is HarnessSurface {
  return s.kind === "harness";
}

export function isDiffSurface(s: Surface): s is DiffSurface {
  return s.kind === "diff";
}

export function isFileBrowserSurface(s: Surface): s is FileBrowserSurface {
  return s.kind === "filebrowser";
}

export function isCommitHistorySurface(s: Surface): s is CommitHistorySurface {
  return s.kind === "commithistory";
}

export function isHarnessPlaceholderSurface(
  s: Surface,
): s is HarnessPlaceholderSurface {
  return s.kind === "harness-placeholder";
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

// --- Aggregated harness status ---

export interface AggregatedHarnessStatus {
  /** The highest-priority status across all harnesses in the workspace. */
  primary: AgentStatus;
  running: number;
  waiting: number;
  idle: number;
  error: number;
  total: number;
}

/** Priority order for agent statuses (higher index = higher priority). */
const STATUS_PRIORITY: AgentStatus[] = [
  "exited",
  "idle",
  "waiting",
  "running",
  "error",
];

/**
 * Aggregate harness statuses across all surfaces in a workspace.
 * Returns null if the workspace has no harness or agent-backed surfaces.
 * Priority: error > running > waiting > idle > exited.
 */
export function getAggregatedHarnessStatus(
  ws: Workspace,
): AggregatedHarnessStatus | null {
  const statuses: AgentStatus[] = [];
  for (const s of getAllSurfaces(ws)) {
    if (isHarnessSurface(s)) {
      statuses.push(s.status);
    } else if (isTerminalSurface(s) && s.agentStatus) {
      statuses.push(s.agentStatus);
    }
  }
  if (statuses.length === 0) return null;

  let running = 0;
  let waiting = 0;
  let idle = 0;
  let error = 0;

  for (const st of statuses) {
    switch (st) {
      case "running":
        running++;
        break;
      case "waiting":
        waiting++;
        break;
      case "idle":
        idle++;
        break;
      case "error":
        error++;
        break;
      // "exited" is not tracked as a separate count — it's just the total minus others
    }
  }

  // Determine primary status by priority
  let primary: AgentStatus = "exited";
  let maxPriority = -1;
  for (const st of statuses) {
    const p = STATUS_PRIORITY.indexOf(st);
    if (p > maxPriority) {
      maxPriority = p;
      primary = st;
    }
  }

  return { primary, running, waiting, idle, error, total: statuses.length };
}
