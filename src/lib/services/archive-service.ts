import { get } from "svelte/store";
import { getAllSurfaces, isTerminalSurface, type Workspace } from "../types";
import type { WorkspaceDef } from "../config";
import { workspaces } from "../stores/workspace";
import {
  serializeLayout,
  closeWorkspace,
  createWorkspaceFromDef,
} from "./workspace-service";
import {
  getWorkspacesInGroup,
  closeWorkspacesInGroup,
  provisionAutoDashboardsForGroup,
} from "./workspace-group-service";
import {
  getWorkspaceGroup,
  getWorkspaceGroups,
  setWorkspaceGroups,
} from "../stores/workspace-groups";
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

export async function archiveWorkspace(wsId: string): Promise<boolean> {
  const ws = get(workspaces).find((w) => w.id === wsId);
  if (!ws) return false;

  const running = countRunningPtys(ws);
  if (running > 0) {
    const confirmed = await showConfirmPrompt(
      `Archiving will suspend ${running} running process${running > 1 ? "es" : ""}. Continue?`,
      { title: "Archive Workspace", confirmLabel: "Archive", danger: true },
    );
    if (!confirmed) return false;
  }

  const def: WorkspaceDef & { name: string } = {
    id: ws.id,
    name: ws.name,
    layout: serializeLayout(ws.splitRoot),
    ...(ws.metadata ? { metadata: ws.metadata } : {}),
  };

  const idx = get(workspaces).findIndex((w) => w.id === wsId);
  closeWorkspace(idx);
  addToArchive({ kind: "workspace", id: wsId }, { def });
  return true;
}

export async function archiveGroup(groupId: string): Promise<boolean> {
  const group = getWorkspaceGroup(groupId);
  if (!group) return false;

  const allInGroup = getWorkspacesInGroup(groupId);
  const nonDashboard = allInGroup.filter((ws) => {
    const md = ws.metadata as Record<string, unknown> | undefined;
    return md?.isDashboard !== true;
  });

  const runningCount = nonDashboard.reduce(
    (sum, ws) => sum + countRunningPtys(ws),
    0,
  );
  if (runningCount > 0) {
    const confirmed = await showConfirmPrompt(
      `Archiving will suspend ${runningCount} running process${runningCount > 1 ? "es" : ""}. Continue?`,
      { title: "Archive Group", confirmLabel: "Archive", danger: true },
    );
    if (!confirmed) return false;
  }

  const workspaceDefs = nonDashboard.map((ws) => ({
    id: ws.id,
    name: ws.name,
    layout: serializeLayout(ws.splitRoot),
    ...(ws.metadata ? { metadata: ws.metadata } : {}),
  }));

  closeWorkspacesInGroup(groupId);
  setWorkspaceGroups(getWorkspaceGroups().filter((g) => g.id !== groupId));
  removeRootRow({ kind: "workspace-group", id: groupId });
  addToArchive(
    { kind: "workspace-group", id: groupId },
    { group, workspaceDefs },
  );
  return true;
}

export async function unarchiveWorkspace(wsId: string): Promise<void> {
  const defs = get(archivedDefs);
  const entry = defs.workspaces[wsId];
  if (!entry) return;
  removeFromArchive({ kind: "workspace", id: wsId });
  await createWorkspaceFromDef(entry.def, { restoring: true });
}

export async function unarchiveGroup(groupId: string): Promise<void> {
  const defs = get(archivedDefs);
  const entry = defs.groups[groupId];
  if (!entry) return;
  removeFromArchive({ kind: "workspace-group", id: groupId });
  setWorkspaceGroups([...getWorkspaceGroups(), entry.group]);
  appendRootRow({ kind: "workspace-group", id: groupId });
  for (const def of entry.workspaceDefs) {
    await createWorkspaceFromDef(def, { restoring: true });
  }
  await provisionAutoDashboardsForGroup(entry.group);
}
