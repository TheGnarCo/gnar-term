import { get } from "svelte/store";
import { getAllSurfaces, isTerminalSurface, type Workspace } from "../types";
import {
  serializeLayout,
  createWorkspaceFromDef,
  closeWorkspace,
} from "./workspace-runtime-service";
import {
  getBranchesOfWorkspace,
  closeWorkspacesInWorkspace,
  provisionAutoDashboardsForWorkspace,
  activateWorkspace,
} from "./workspace-service";
import {
  activeWorkspace,
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

  // Global registry workspaces (standalone dashboards: Settings, Keyboard
  // Shortcuts, etc.) have no archive lifecycle — there's nothing to
  // restore on unarchive because they're owned by `globalSurfaceRegistry`,
  // not by user data. Treat archive as delete: tear down the workspace
  // and skip the archive entry entirely.
  if (
    workspace.isDashboard === true &&
    typeof workspace.rootWorkspaceId !== "string"
  ) {
    const idx = getWorkspaces().findIndex((w) => w.id === workspaceId);
    if (idx >= 0) closeWorkspace(idx);
    return true;
  }

  // Dashboards are tabs in the workspace's pane, not separate
  // workspaces — branches are the only entries returned here.
  const nonDashboard = getBranchesOfWorkspace(workspaceId);

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

  // After the archive's child workspaces close, the runtime active idx
  // is clamped (Math.min) and can land on a dashboard chip of an
  // unrelated workspace — or fall off the list entirely. Always route
  // post-archive activation back to a root workspace's terminal tabs.
  const after = get(activeWorkspace);
  if (!after || after.isDashboard === true) {
    const [nextRoot] = getWorkspaces();
    if (nextRoot) await activateWorkspace(nextRoot.id);
  }
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
