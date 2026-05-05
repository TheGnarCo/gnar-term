/**
 * Workspace Overview — pure data transformation for the global
 * Workspaces dashboard.
 *
 * `buildGroups` maps primary workspaces + child workspaces into a
 * grouped display structure. Dashboard/pseudo-workspace child
 * workspaces are filtered out so the dashboard doesn't list itself or
 * Settings tabs.
 */
import type { Workspace } from "../types";
import { isBranchedWorkspace } from "../types";

export interface WorkspaceGroup {
  /** The primary workspace, or null for standalone child workspaces. */
  workspace: Workspace | null;
  /** Real (non-dashboard) child workspaces belonging to this group. */
  rows: Workspace[];
}

/**
 * Build a grouped display structure for the Workspace Overview dashboard.
 *
 * - Dashboard workspaces are always excluded (they are managed UI, not
 *   user-visible workspace rows).
 * - Primary workspaces are identified by the presence of `path` and
 *   absence of `parentWorkspaceId`. Each gets its own group, in array
 *   order from `allWorkspaces`.
 * - Child workspaces (`parentWorkspaceId` set) that reference a known
 *   primary are placed in that primary's group.
 * - Workspaces that fit neither category — standalone children with no
 *   path/parent, or orphaned children whose parent is unknown — collect
 *   at the end under a group with a `null` workspace.
 * - Empty primary groups (primary has no real child workspaces) are
 *   included so the user can still see the primary workspace exists.
 */
export function buildGroups(allWorkspaces: Workspace[]): WorkspaceGroup[] {
  // Drop dashboards entirely — they are not user-listable workspaces.
  const visible = allWorkspaces.filter((w) => !w.isDashboard);

  // Primary: no parentWorkspaceId AND has a path (project-level fields present).
  const primaries = visible.filter((w) => !w.parentWorkspaceId && !!w.path);

  // Map primaryId → WorkspaceGroup for quick lookup.
  const primaryMap = new Map<string, WorkspaceGroup>();
  const groups: WorkspaceGroup[] = [];

  for (const primary of primaries) {
    const group: WorkspaceGroup = { workspace: primary, rows: [] };
    primaryMap.set(primary.id, group);
    groups.push(group);
  }

  // Standalone collector at the end (children w/o known parent + bare
  // workspaces lacking both path and parentWorkspaceId).
  const standalones: WorkspaceGroup = { workspace: null, rows: [] };
  const primarySet = new Set(primaries.map((p) => p.id));

  for (const ws of visible) {
    if (primarySet.has(ws.id)) continue; // already a header
    const parentWorkspaceId = ws.parentWorkspaceId;
    if (parentWorkspaceId) {
      const group = primaryMap.get(parentWorkspaceId);
      if (group) {
        group.rows.push(ws);
        continue;
      }
    }
    // Either parentWorkspaceId points to a missing primary, or no
    // parentWorkspaceId AND no path — both end up in the standalone bucket.
    standalones.rows.push(ws);
  }

  if (standalones.rows.length > 0) {
    groups.push(standalones);
  }

  return groups;
}

/**
 * Resolve the filesystem path to use for git-dirty tracking for a
 * given child workspace.
 *
 * - Worktree-backed workspaces: `worktreePath` (the checked-out tree).
 * - Child workspace with a known parent primary: falls back to
 *   `parentPrimary.path` if no worktreePath.
 * - Standalone with no path info: returns null — no indicator rendered.
 */
export function resolveDirtyPath(
  ws: Workspace,
  parentPrimary: Workspace | null,
): string | null {
  if (isBranchedWorkspace(ws) && ws.worktreePath) {
    return ws.worktreePath;
  }
  if (parentPrimary?.path) {
    return parentPrimary.path;
  }
  return null;
}
