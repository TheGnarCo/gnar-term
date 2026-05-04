/**
 * Workspace Overview — pure data transformation for the global
 * Workspaces dashboard.
 *
 * `buildGroups` maps umbrella workspaces + nested workspaces into a
 * grouped display structure. Dashboard/pseudo-workspace nested
 * workspaces are filtered out so the dashboard doesn't list itself or
 * Settings tabs.
 */
import type { Workspace } from "../config";
import type { NestedWorkspace } from "../types";

export interface WorkspaceGroup {
  /** The umbrella workspace, or null for standalone nested workspaces. */
  umbrella: Workspace | null;
  /** Real (non-dashboard) nested workspaces belonging to this group. */
  rows: NestedWorkspace[];
}

/**
 * Build a grouped display structure for the Workspace Overview dashboard.
 *
 * - Dashboard and pseudo-workspace nested workspaces are excluded.
 * - Each umbrella workspace gets its own group (in array order from
 *   `workspaces`). Branched nested workspaces that reference an umbrella
 *   via `metadata.parentWorkspaceId` are placed in that group.
 * - Standalone nested workspaces (no parentWorkspaceId, or the parent
 *   is not in the workspaces list) are collected at the end under a
 *   `null` umbrella group, in the order they appear in `nestedWsList`.
 * - Empty umbrella groups (umbrella has no real nested workspaces) are
 *   included so the user can still see the umbrella exists.
 */
export function buildGroups(
  workspaces: Workspace[],
  nestedWsList: NestedWorkspace[],
): WorkspaceGroup[] {
  // Filter to only real (non-dashboard) nested workspaces.
  const realNested = nestedWsList.filter((w) => !w.metadata?.isDashboard);

  // Map umbrellaId → WorkspaceGroup for quick lookup.
  const umbrellaMap = new Map<string, WorkspaceGroup>();
  const groups: WorkspaceGroup[] = [];

  for (const umbrella of workspaces) {
    const group: WorkspaceGroup = { umbrella, rows: [] };
    umbrellaMap.set(umbrella.id, group);
    groups.push(group);
  }

  // Standalone collector at the end.
  const standalones: WorkspaceGroup = { umbrella: null, rows: [] };

  for (const nw of realNested) {
    const parentId = nw.metadata?.parentWorkspaceId;
    if (parentId) {
      const group = umbrellaMap.get(parentId);
      if (group) {
        group.rows.push(nw);
        continue;
      }
    }
    standalones.rows.push(nw);
  }

  if (standalones.rows.length > 0) {
    groups.push(standalones);
  }

  return groups;
}

/**
 * Resolve the filesystem path to use for git-dirty tracking for a
 * given nested workspace.
 *
 * - Worktree-backed workspaces: `metadata.worktreePath` (the checked-out tree).
 * - Branched workspace with a known parent umbrella: falls back to
 *   `parentUmbrella.path` if no worktreePath.
 * - Standalone with no path info: returns null — no indicator rendered.
 */
export function resolveDirtyPath(
  nw: NestedWorkspace,
  parentUmbrella: Workspace | null,
): string | null {
  const worktreePath = nw.metadata?.worktreePath;
  if (typeof worktreePath === "string" && worktreePath) {
    return worktreePath;
  }
  if (parentUmbrella?.path) {
    return parentUmbrella.path;
  }
  return null;
}
