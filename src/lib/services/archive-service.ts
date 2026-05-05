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

export async function archiveWorkspace(
  parentWorkspaceId: string,
): Promise<boolean> {
  const workspace = getWorkspace(parentWorkspaceId);
  if (!workspace) return false;
  if (workspace.locked) return false;

  const allInWorkspace = getChildrenOfWorkspace(parentWorkspaceId);
  const nonDashboard = allInWorkspace.filter(
    (ws) => !isDashboardWorkspace(ws, parentWorkspaceId),
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

  const workspaceDefs = nonDashboard.map((ws) => ({
    id: ws.id,
    name: ws.name,
    layout: serializeLayout(ws.splitRoot),
    ...(ws.metadata ? { metadata: ws.metadata } : {}),
  }));

  setWorkspaces(getWorkspaces().filter((w) => w.id !== parentWorkspaceId));
  removeRootRow({ kind: "workspace", id: parentWorkspaceId });
  closeWorkspacesInWorkspace(parentWorkspaceId);
  addToArchive(parentWorkspaceId, {
    workspace,
    childWorkspaceDefs: workspaceDefs,
  });
  return true;
}

export async function unarchiveWorkspace(
  parentWorkspaceId: string,
): Promise<void> {
  const defs = get(archivedDefs);
  const entry = defs.workspaces[parentWorkspaceId];
  if (!entry) return;
  // Container (workspace + root row) must be in place before we restore
  // workspaces into it, but `removeFromArchive` is held until every
  // async restore step has resolved — if any throws, the archive entry
  // survives so the user can retry.
  setWorkspaces([...getWorkspaces(), entry.workspace]);
  appendRootRow({ kind: "workspace", id: parentWorkspaceId });
  for (const def of entry.childWorkspaceDefs) {
    await createWorkspaceFromDef(def, { restoring: true });
  }
  await provisionAutoDashboardsForWorkspace(entry.workspace);
  removeFromArchive(parentWorkspaceId);
}
