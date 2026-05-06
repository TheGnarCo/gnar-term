import { get } from "svelte/store";
import { getAllSurfaces, isTerminalSurface, type Workspace } from "../types";
import {
  serializeLayout,
  createWorkspaceFromDef,
} from "./workspace-runtime-service";
import {
  getChildrenOfWorkspace,
  closeWorkspacesInWorkspace,
  isDashboardWorkspace,
  provisionAutoDashboardsForWorkspace,
} from "./workspace-service";
import {
  getWorkspace,
  getWorkspaces,
  setWorkspaces,
} from "../stores/workspace";
import { removeRootRow, appendRootRow } from "../stores/root-row-order";
import { showConfirmPrompt } from "../stores/ui";
import {
  addToArchive,
  removeFromArchive,
  archivedDefs,
} from "../stores/archive";

function countRunningPtys(ws: Workspace): number {
  return getAllSurfaces(ws).filter((s) => isTerminalSurface(s) && s.ptyId >= 0)
    .length;
}

export async function archiveWorkspace(workspaceId: string): Promise<boolean> {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return false;
  if (workspace.locked) return false;

  const allInWorkspace = getChildrenOfWorkspace(workspaceId);
  const nonDashboard = allInWorkspace.filter(
    (ws) => !isDashboardWorkspace(ws, workspaceId),
  );

  const runningCount = nonDashboard.reduce(
    (sum, ws) => sum + countRunningPtys(ws),
    0,
  );
  if (runningCount > 0) {
    const confirmed = await showConfirmPrompt(
      `Archiving will suspend ${runningCount} running process${runningCount > 1 ? "es" : ""}. Continue?`,
      { title: "Archive Workspace", confirmLabel: "Archive", danger: true },
    );
    if (!confirmed) return false;
  }

  const workspaceDefs = nonDashboard.map((ws) => {
    const bw = ws as Workspace & {
      worktreePath?: string;
      branch?: string;
      baseBranch?: string;
      repoPath?: string;
    };
    return {
      id: ws.id,
      name: ws.name,
      layout: serializeLayout(ws.paneLayout),
      ...(ws.rootWorkspaceId !== undefined
        ? { rootWorkspaceId: ws.rootWorkspaceId }
        : {}),
      ...(ws.isDashboard !== undefined ? { isDashboard: ws.isDashboard } : {}),
      ...(ws.dashboardContributionId !== undefined
        ? { dashboardContributionId: ws.dashboardContributionId }
        : {}),
      ...(ws.locked !== undefined ? { locked: ws.locked } : {}),
      ...(bw.worktreePath !== undefined
        ? { worktreePath: bw.worktreePath }
        : {}),
      ...(bw.branch !== undefined ? { branch: bw.branch } : {}),
      ...(bw.baseBranch !== undefined ? { baseBranch: bw.baseBranch } : {}),
      ...(bw.repoPath !== undefined ? { repoPath: bw.repoPath } : {}),
      ...(ws.spawnedBy !== undefined ? { spawnedBy: ws.spawnedBy } : {}),
      ...(ws.spawnedFromIssues !== undefined
        ? { spawnedFromIssues: ws.spawnedFromIssues }
        : {}),
      ...(ws.extensionData !== undefined
        ? { extensionData: ws.extensionData }
        : {}),
    };
  });

  setWorkspaces(getWorkspaces().filter((w) => w.id !== workspaceId));
  removeRootRow({ kind: "workspace", id: workspaceId });
  closeWorkspacesInWorkspace(workspaceId);
  addToArchive(workspaceId, {
    workspace,
    childWorkspaceDefs: workspaceDefs,
  });
  return true;
}

export async function unarchiveWorkspace(workspaceId: string): Promise<void> {
  const defs = get(archivedDefs);
  const entry = defs.workspaces[workspaceId];
  if (!entry) return;
  // Container (workspace + root row) must be in place before we restore
  // workspaces into it, but `removeFromArchive` is held until every
  // async restore step has resolved — if any throws, the archive entry
  // survives so the user can retry.
  setWorkspaces([...getWorkspaces(), entry.workspace]);
  appendRootRow({ kind: "workspace", id: workspaceId });
  for (const def of entry.childWorkspaceDefs) {
    await createWorkspaceFromDef(def, { restoring: true });
  }
  await provisionAutoDashboardsForWorkspace(entry.workspace);
  removeFromArchive(workspaceId);
}
