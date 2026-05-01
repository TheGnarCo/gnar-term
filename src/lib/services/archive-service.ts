import { get } from "svelte/store";
import {
  getAllSurfaces,
  isTerminalSurface,
  type NestedWorkspace,
} from "../types";
import {
  serializeLayout,
  createNestedWorkspaceFromDef,
} from "./workspace-service";
import { wsMeta } from "./service-helpers";
import {
  getWorktreeWorkspaces,
  closeNestedWorkspacesInWorkspace,
  provisionAutoDashboardsForWorkspace,
} from "./workspace-group-service";
import {
  getWorkspace,
  getWorkspaces,
  setWorkspaces,
} from "../stores/workspace-groups";
import { removeRootRow, appendRootRow } from "../stores/root-row-order";
import { showConfirmPrompt } from "../stores/ui";
import {
  addToArchive,
  removeFromArchive,
  archivedDefs,
} from "../stores/archive";

function isDashboardWorkspace(ws: NestedWorkspace): boolean {
  return wsMeta(ws).isDashboard === true;
}

function countRunningPtys(ws: NestedWorkspace): number {
  return getAllSurfaces(ws).filter((s) => isTerminalSurface(s) && s.ptyId >= 0)
    .length;
}

export async function archiveWorkspace(
  parentWorkspaceId: string,
): Promise<boolean> {
  const group = getWorkspace(parentWorkspaceId);
  if (!group) return false;
  if (group.locked) return false;

  const allInGroup = getWorktreeWorkspaces(parentWorkspaceId);
  const nonDashboard = allInGroup.filter((ws) => !isDashboardWorkspace(ws));

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

  closeNestedWorkspacesInWorkspace(parentWorkspaceId);
  setWorkspaces(getWorkspaces().filter((g) => g.id !== parentWorkspaceId));
  removeRootRow({ kind: "workspace-group", id: parentWorkspaceId });
  addToArchive(
    { kind: "workspace-group", id: parentWorkspaceId },
    { group, workspaceDefs },
  );
  return true;
}

export async function unarchiveWorkspace(
  parentWorkspaceId: string,
): Promise<void> {
  const defs = get(archivedDefs);
  const entry = defs.groups[parentWorkspaceId];
  if (!entry) return;
  // Container (group + root row) must be in place before we restore
  // nestedWorkspaces into it, but `removeFromArchive` is held until every
  // async restore step has resolved — if any throws, the archive entry
  // survives so the user can retry.
  setWorkspaces([...getWorkspaces(), entry.group]);
  appendRootRow({ kind: "workspace-group", id: parentWorkspaceId });
  for (const def of entry.workspaceDefs) {
    await createNestedWorkspaceFromDef(def, { restoring: true });
  }
  await provisionAutoDashboardsForWorkspace(entry.group);
  removeFromArchive({ kind: "workspace-group", id: parentWorkspaceId });
}
