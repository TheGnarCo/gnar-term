/**
 * Workspace Overview — pure data transformation for the global
 * Workspaces dashboard.
 *
 * `buildOverviewSections` maps the unified workspace store into a
 * sectioned display structure: each Workspace and its Branches.
 * Dashboard rows are filtered out so the dashboard doesn't list itself
 * or Settings tabs.
 */
import type { Workspace } from "../types";
import { isBranchedWorkspace } from "../types";

/**
 * Build a sectioned display structure for the Workspace Overview dashboard.
 *
 * - Dashboard rows are always excluded (managed UI, not user-listable).
 * - Root Workspaces are identified by `path` set and `parentWorkspaceId`
 *   absent. Each Workspace gets its own section, in input order.
 * - Branches (`parentWorkspaceId` set) referencing a known Workspace
 *   are placed under that Workspace's section.
 * - Rows that fit neither — orphaned Branches whose owning Workspace is
 *   missing, or bare rows lacking both path and parentWorkspaceId —
 *   collect at the end under a section with `workspace: null`.
 * - Empty Workspace sections are kept so the user can still see the
 *   Workspace exists.
 */
export function buildOverviewSections(
  allWorkspaces: Workspace[],
): Array<{ workspace: Workspace | null; branches: Workspace[] }> {
  const visible = allWorkspaces.filter((w) => !w.isDashboard);

  const roots = visible.filter((w) => !w.parentWorkspaceId && !!w.path);

  const sectionByRootId = new Map<
    string,
    { workspace: Workspace | null; branches: Workspace[] }
  >();
  const sections: Array<{
    workspace: Workspace | null;
    branches: Workspace[];
  }> = [];

  for (const root of roots) {
    const section = { workspace: root as Workspace | null, branches: [] };
    sectionByRootId.set(root.id, section);
    sections.push(section);
  }

  const orphans: { workspace: Workspace | null; branches: Workspace[] } = {
    workspace: null,
    branches: [],
  };
  const rootSet = new Set(roots.map((r) => r.id));

  for (const ws of visible) {
    if (rootSet.has(ws.id)) continue;
    const parentId = ws.parentWorkspaceId;
    if (parentId) {
      const section = sectionByRootId.get(parentId);
      if (section) {
        section.branches.push(ws);
        continue;
      }
    }
    orphans.branches.push(ws);
  }

  if (orphans.branches.length > 0) {
    sections.push(orphans);
  }

  return sections;
}

/**
 * Resolve the filesystem path used for git-dirty tracking for a
 * given Branch row.
 *
 * - Worktree-backed Branches: `worktreePath` (the checked-out tree).
 * - Branch with a known owning Workspace: falls back to that
 *   Workspace's `path` if no worktreePath.
 * - Standalone with no path info: returns null — no indicator rendered.
 */
export function resolveDirtyPath(
  ws: Workspace,
  rootWorkspace: Workspace | null,
): string | null {
  if (isBranchedWorkspace(ws) && ws.worktreePath) {
    return ws.worktreePath;
  }
  if (rootWorkspace?.path) {
    return rootWorkspace.path;
  }
  return null;
}
