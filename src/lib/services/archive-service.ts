import { get } from "svelte/store";
import {
  getAllSurfaces,
  isTerminalSurface,
  type NestedWorkspace,
} from "../types";
import {
  serializeLayout,
  createNestedWorkspaceFromDef,
} from "./nested-workspace-service";
import { wsMeta } from "./service-helpers";
import {
  getWorktreeWorkspaces,
  closeNestedWorkspacesInWorkspace,
  provisionAutoDashboardsForWorkspace,
} from "./workspace-service";
import {
  getWorkspace,
  getWorkspaces,
  setWorkspaces,
} from "../stores/workspaces";
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
  const workspace = getWorkspace(parentWorkspaceId);
  if (!workspace) return false;
  if (workspace.locked) return false;

  const allInWorkspace = getWorktreeWorkspaces(parentWorkspaceId);
  const nonDashboard = allInWorkspace.filter((ws) => !isDashboardWorkspace(ws));

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

  // Remove the umbrella from the store BEFORE cascading the close. The
  // close path emits `workspace:closed`, and
  // `setupPrimaryWorkspaceAutoRecreation` looks the umbrella up by
  // `primaryNestedWorkspaceId` to spawn a replacement. While the umbrella
  // still sits in the store the listener creates a phantom nested
  // workspace whose `parentWorkspaceId` then dangles after the umbrella
  // is removed — on reload that orphan re-wraps into a fresh umbrella,
  // so archives appear to leak ghost workspaces.
  setWorkspaces(getWorkspaces().filter((w) => w.id !== parentWorkspaceId));
  removeRootRow({ kind: "workspace", id: parentWorkspaceId });
  closeNestedWorkspacesInWorkspace(parentWorkspaceId);
  addToArchive(parentWorkspaceId, {
    workspace,
    nestedWorkspaceDefs: workspaceDefs,
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
  // nestedWorkspaces into it, but `removeFromArchive` is held until every
  // async restore step has resolved — if any throws, the archive entry
  // survives so the user can retry.
  setWorkspaces([...getWorkspaces(), entry.workspace]);
  appendRootRow({ kind: "workspace", id: parentWorkspaceId });
  for (const def of entry.nestedWorkspaceDefs) {
    await createNestedWorkspaceFromDef(def, { restoring: true });
  }
  await provisionAutoDashboardsForWorkspace(entry.workspace);
  removeFromArchive(parentWorkspaceId);
}
