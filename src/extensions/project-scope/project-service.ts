/**
 * Workspace Group state helpers — the single path through which
 * project-scope components mutate the persisted group list.
 *
 * Components (WorkspaceGroupSectionContent, WorkspaceGroupRowBody, …)
 * call these helpers instead of reaching into `api.state.set` directly
 * so that the read → mutate → emit sequence stays consistent (and
 * testable).
 *
 * Note: the state-slot key is still `"projects"` and the emitted event
 * is still `"extension:project:state-changed"` — those are wire formats
 * (persisted user data / subscriber contracts) and change together with
 * the schema migration in a later stage.
 */
import type { ExtensionAPI } from "../api";
import type { WorkspaceGroupEntry } from "./index";

const PROJECTS_KEY = "projects";
const PROJECT_ORDER_KEY = "projectOrder";
const STATE_CHANGED_EVENT = "extension:project:state-changed";

export function getWorkspaceGroups(api: ExtensionAPI): WorkspaceGroupEntry[] {
  return api.state.get<WorkspaceGroupEntry[]>(PROJECTS_KEY) ?? [];
}

export function getWorkspaceGroup(
  api: ExtensionAPI,
  id: string,
): WorkspaceGroupEntry | undefined {
  return getWorkspaceGroups(api).find((g) => g.id === id);
}

function writeWorkspaceGroups(
  api: ExtensionAPI,
  next: WorkspaceGroupEntry[],
  metadata: Record<string, unknown> = {},
): void {
  api.state.set(PROJECTS_KEY, next);
  api.emit(STATE_CHANGED_EVENT, metadata);
}

export function addWorkspaceGroup(
  api: ExtensionAPI,
  group: WorkspaceGroupEntry,
): void {
  writeWorkspaceGroups(api, [...getWorkspaceGroups(api), group], {
    projectId: group.id,
  });
  // Mirror the group into the core root-row list so it renders inside
  // the Workspaces section alongside unclaimed workspaces.
  api.appendRootRow({ kind: "project", id: group.id });
}

export function updateWorkspaceGroup(
  api: ExtensionAPI,
  id: string,
  patch: Partial<Omit<WorkspaceGroupEntry, "id">>,
): void {
  const next = getWorkspaceGroups(api).map((g) =>
    g.id === id ? { ...g, ...patch } : g,
  );
  writeWorkspaceGroups(api, next, { projectId: id });
}

export function deleteWorkspaceGroup(api: ExtensionAPI, id: string): void {
  const next = getWorkspaceGroups(api).filter((g) => g.id !== id);
  writeWorkspaceGroups(api, next, { projectId: id });
  api.removeRootRow({ kind: "project", id });
}

export function setWorkspaceGroupOrder(api: ExtensionAPI, ids: string[]): void {
  api.state.set(PROJECT_ORDER_KEY, ids);
  api.emit(STATE_CHANGED_EVENT, {});
}

/**
 * Appends `workspaceId` to `groupId`'s workspaceIds if not already
 * present. No-op when the group is missing (e.g. was just deleted).
 * Does NOT emit when nothing changed, so listeners don't spin.
 */
export function addWorkspaceToGroup(
  api: ExtensionAPI,
  groupId: string,
  workspaceId: string,
): boolean {
  const groups = getWorkspaceGroups(api);
  let changed = false;
  const next = groups.map((g) => {
    if (g.id === groupId && !g.workspaceIds.includes(workspaceId)) {
      changed = true;
      return { ...g, workspaceIds: [...g.workspaceIds, workspaceId] };
    }
    return g;
  });
  if (!changed) return false;
  writeWorkspaceGroups(api, next, { projectId: groupId });
  return true;
}

/**
 * Strips `workspaceId` from every group's workspaceIds. Used when a
 * workspace is closed — we don't know which group owned it, and
 * removing from all is cheap and idempotent.
 */
export function removeWorkspaceFromAllGroups(
  api: ExtensionAPI,
  workspaceId: string,
): void {
  const next = getWorkspaceGroups(api).map((g) => ({
    ...g,
    workspaceIds: g.workspaceIds.filter((id) => id !== workspaceId),
  }));
  writeWorkspaceGroups(api, next, {});
}

/**
 * Clears every group's workspaceIds. Used at activation time because
 * workspace IDs are regenerated each restart — the workspace:created
 * handler rebuilds the list from metadata.projectId as restores land.
 */
export function clearWorkspaceIds(api: ExtensionAPI): void {
  const next = getWorkspaceGroups(api).map((g) => ({ ...g, workspaceIds: [] }));
  api.state.set(PROJECTS_KEY, next);
  // No emit — this fires during onActivate before subscribers exist, and
  // would just produce a spurious change event for the initial load.
}
