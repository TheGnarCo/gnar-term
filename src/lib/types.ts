import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { SearchAddon } from "@xterm/addon-search";
import type { AgentType } from "./services/agent-type";

let _id = 0;
export function uid(): string {
  return `id-${++_id}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Unified Workspace type hierarchy
// ---------------------------------------------------------------------------

/**
 * Base: every workspace has its own pane layout + optional Workspace-level fields.
 * Path-rooted Workspaces carry `path`, `color`, `isGit`, `createdAt`.
 * Branches (branched + dashboards) are identified by `rootWorkspaceId`.
 */
export interface Workspace {
  id: string;
  name: string;
  paneLayout: SplitNode;
  activePaneId: string | null;
  // Workspace-level (present on path-rooted Workspaces, absent on Branches)
  path?: string;
  /**
   * Inode of `path` at last successful sweep. Used by the rename-
   * detection probe in `validateWorkspaceRootPaths` to rediscover the
   * workspace when its directory is renamed within the same parent on
   * a Unix filesystem. Unset until the first sweep populates it.
   */
  pathInode?: number;
  color?: string;
  isGit?: boolean;
  createdAt?: string;
  // Branch navigation
  lastActiveBranchedWorkspaceId?: string;
  /**
   * Set on a root Workspace ONLY. Holds the runtime id of that Workspace's
   * overview Dashboard Workspace, so `openWorkspaceDashboard` can activate
   * it directly. Never carries a contribution id — that lives on the
   * dashboard workspace itself in `dashboardContributionId`.
   */
  dashboardWorkspaceId?: string;
  // Flags
  locked?: boolean;
  pathMissing?: boolean; // runtime-only, not persisted
  autoRunRestoreCommands?: boolean;
  // Dashboard flag — present on Branches that are overview dashboards
  isDashboard?: boolean;
  /**
   * Set on a Dashboard Workspace ONLY. Stable identifier of the dashboard
   * contribution this workspace renders (e.g. `"overview"`, `"settings"`,
   * `"agentic"`, `"ext:foo"`). Used to look up the contribution in the
   * Dashboard registry.
   */
  dashboardContributionId?: string;
  /**
   * Set on a root Workspace ONLY. Contribution ids the user has dismissed
   * for this workspace — `defaultEnabled` contributions in this list are
   * NOT re-provisioned by `provisionAutoDashboardsForWorkspace`. Cleared
   * for a contribution when the user re-enables it from Workspace Settings.
   * Has no effect on `autoProvision` contributions (those are locked-on).
   */
  dismissedDashboardContributionIds?: string[];
  /**
   * Set on a root Workspace ONLY. Contribution ids the user has explicitly
   * enabled for this workspace via Workspace Settings. Drives chip presence
   * for opt-in (neither autoProvision nor defaultEnabled) contributions.
   * Independent of whether a dashboard tab is currently open — closing a
   * tab does not remove the contribution from this list.
   */
  enabledDashboardContributionIds?: string[];
  // Extension data — replaces open-ended metadata index signature
  extensionData?: Record<string, unknown>;
  // Root Workspace reference — presence discriminates Branches from root Workspaces
  rootWorkspaceId?: string;
  /**
   * Set on root Workspaces ONLY. Ordered list of Branch / Dashboard ids
   * whose `rootWorkspaceId` points back here. `rootWorkspaceId` is the
   * canonical membership tag (reclaimed on startup); this array exists
   * only to preserve user-controlled ordering (drag/drop, insert
   * position). Do NOT use this as a membership query — derive from
   * `rootWorkspaceId` instead.
   */
  branchedWorkspaceIds?: string[];
  /**
   * Provenance marker — when set, the workspace was spawned from a
   * dashboard. Drives the bot-icon affordance in the sidebar.
   */
  spawnedBy?:
    | { kind: "global" }
    | { kind: "workspace"; rootWorkspaceId: string };
  /**
   * GitHub issue numbers a worktree workspace was spawned to handle.
   * Drives the bot-icon "jump to active workspace" affordance on the
   * Issues widget.
   */
  spawnedFromIssues?: number[];
}

/**
 * Worktree-backed Workspace variant. Carries the root Workspace back-reference
 * plus worktree fields. Created by the branched-workspaces extension via
 * `worktree-service` in core.
 */
export interface BranchedWorkspace extends Workspace {
  rootWorkspaceId: string;
  worktreePath: string;
  branch: string;
  baseBranch?: string;
  repoPath?: string;
}

/** Type guard: narrows to BranchedWorkspace via the worktreePath marker. */
export function isBranchedWorkspace(ws: Workspace): ws is BranchedWorkspace {
  return (
    typeof (ws as BranchedWorkspace).rootWorkspaceId === "string" &&
    typeof (ws as BranchedWorkspace).worktreePath === "string"
  );
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

export interface RegistrySurface {
  kind: "registry";
  id: string;
  surfaceTypeId: string; // maps to SurfaceTypeDef.id in the registry
  title: string;
  hasUnread: boolean;
  notification?: string;
  props?: Record<string, unknown>; // arbitrary data passed to the surface component
  dispose?: () => void;
  /**
   * Identifies a registry surface as the tab manifestation of a
   * `DashboardContribution`. Stamped by `openDashboardSurfaceTab` from
   * `DashboardTabSpec.dashboardContributionId`. Used by the Settings
   * panel (active-state detection) and `closeDashboardContributionTab`
   * (find-and-remove-by-contribution) without leaking structural
   * metadata into the surface component's `props`.
   */
  dashboardContributionId?: string;
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

export type Surface = TerminalSurface | RegistrySurface | PreviewSurface;

export interface Pane {
  id: string;
  surfaces: Surface[];
  activeSurfaceId: string | null;
  resizeObserver?: ResizeObserver;
  element?: HTMLElement;
  exitedSurface?: { code: number; definedCommand?: string; cwd?: string };
  /**
   * Optional hint for the intended agent type. Set by `createWorkspaceFromDef`
   * when a pane definition carries `intendedAgent`. The detection service
   * prefers a *confirmed detected* agent over this hint — `intendedAgent`
   * is only used as an initial value for `paneAgentTypeStore` before
   * any detection fires.
   */
  intendedAgent?: AgentType;
}

export type SplitNode =
  | { type: "pane"; pane: Pane }
  | {
      type: "split";
      direction: "horizontal" | "vertical";
      children: [SplitNode, SplitNode];
      ratio: number;
    };

// Helper functions for tree traversal
export function getAllPanes(node: SplitNode): Pane[] {
  if (node.type === "pane") return [node.pane];
  return [...getAllPanes(node.children[0]), ...getAllPanes(node.children[1])];
}

export function getAllSurfaces(ws: { paneLayout: SplitNode }): Surface[] {
  return getAllPanes(ws.paneLayout).flatMap((p) => p.surfaces);
}

export function isTerminalSurface(s: Surface): s is TerminalSurface {
  return s.kind === "terminal";
}

export function isRegistrySurface(s: Surface): s is RegistrySurface {
  return s.kind === "registry";
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
