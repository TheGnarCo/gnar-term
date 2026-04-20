/**
 * Project state helpers — the single path through which project-scope
 * components mutate the `projects` / `projectOrder` state slots.
 *
 * Components (ProjectsContainer, ProjectSectionContent, …) call these
 * helpers instead of reaching into `api.state.set` directly so that the
 * read → mutate → emit sequence stays consistent (and testable).
 */
import type { ExtensionAPI } from "../api";
import type { ProjectEntry } from "./index";

const PROJECTS_KEY = "projects";
const PROJECT_ORDER_KEY = "projectOrder";
const STATE_CHANGED_EVENT = "extension:project:state-changed";

export function getProjects(api: ExtensionAPI): ProjectEntry[] {
  return api.state.get<ProjectEntry[]>(PROJECTS_KEY) ?? [];
}

export function getProject(
  api: ExtensionAPI,
  id: string,
): ProjectEntry | undefined {
  return getProjects(api).find((p) => p.id === id);
}

function writeProjects(
  api: ExtensionAPI,
  next: ProjectEntry[],
  metadata: Record<string, unknown> = {},
): void {
  api.state.set(PROJECTS_KEY, next);
  api.emit(STATE_CHANGED_EVENT, metadata);
}

export function addProject(api: ExtensionAPI, project: ProjectEntry): void {
  writeProjects(api, [...getProjects(api), project], { projectId: project.id });
  // Mirror the project into the core root-row list so it renders
  // inside the Workspaces section alongside unclaimed workspaces.
  api.appendRootRow({ kind: "project", id: project.id });
}

export function updateProject(
  api: ExtensionAPI,
  id: string,
  patch: Partial<Omit<ProjectEntry, "id">>,
): void {
  const next = getProjects(api).map((p) =>
    p.id === id ? { ...p, ...patch } : p,
  );
  writeProjects(api, next, { projectId: id });
}

export function deleteProject(api: ExtensionAPI, id: string): void {
  const next = getProjects(api).filter((p) => p.id !== id);
  writeProjects(api, next, { projectId: id });
  api.removeRootRow({ kind: "project", id });
}

export function setProjectOrder(api: ExtensionAPI, ids: string[]): void {
  api.state.set(PROJECT_ORDER_KEY, ids);
  api.emit(STATE_CHANGED_EVENT, {});
}

/**
 * Appends `workspaceId` to `projectId`'s workspaceIds if not already
 * present. No-op when the project is missing (e.g. was just deleted).
 * Does NOT emit when nothing changed, so listeners don't spin.
 */
export function addWorkspaceToProject(
  api: ExtensionAPI,
  projectId: string,
  workspaceId: string,
): boolean {
  const projects = getProjects(api);
  let changed = false;
  const next = projects.map((p) => {
    if (p.id === projectId && !p.workspaceIds.includes(workspaceId)) {
      changed = true;
      return { ...p, workspaceIds: [...p.workspaceIds, workspaceId] };
    }
    return p;
  });
  if (!changed) return false;
  writeProjects(api, next, { projectId });
  return true;
}

/**
 * Strips `workspaceId` from every project's workspaceIds. Used when a
 * workspace is closed — we don't know which project owned it, and
 * removing from all is cheap and idempotent.
 */
export function removeWorkspaceFromAllProjects(
  api: ExtensionAPI,
  workspaceId: string,
): void {
  const next = getProjects(api).map((p) => ({
    ...p,
    workspaceIds: p.workspaceIds.filter((id) => id !== workspaceId),
  }));
  writeProjects(api, next, {});
}

/**
 * Clears every project's workspaceIds. Used at activation time because
 * workspace IDs are regenerated each restart — the workspace:created
 * handler rebuilds the list from metadata.projectId as restores land.
 */
export function clearWorkspaceIds(api: ExtensionAPI): void {
  const next = getProjects(api).map((p) => ({ ...p, workspaceIds: [] }));
  api.state.set(PROJECTS_KEY, next);
  // No emit — this fires during onActivate before subscribers exist, and
  // would just produce a spurious change event for the initial load.
}
