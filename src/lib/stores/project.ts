/**
 * Project store — reactive Svelte store backed by state.ts persistence.
 *
 * Every mutation updates both the Svelte store (for reactivity) and the
 * state.ts layer (for persistence). Call saveState() after mutations
 * to write to disk.
 */

import { writable, derived } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import {
  getState,
  addProject as stateAddProject,
  removeProject as stateRemoveProject,
  reorderProjects as stateReorderProjects,
  addWorkspace as stateAddWorkspace,
  removeWorkspace,
  updateWorkspaceStatus,
  saveState,
  nextProjectColor,
  type ProjectState,
} from "../state";
import { removeWorktree, pushBranch } from "../git";
import { uid } from "../types";

// --- Stores ---

export const projects = writable<ProjectState[]>([]);

export const activeProjects = derived(projects, ($p) =>
  $p.filter((p) => p.active),
);

export const inactiveProjects = derived(projects, ($p) =>
  $p.filter((p) => !p.active),
);

// --- Init ---

/** Load projects from state.ts into the Svelte store */
export function initProjects(): void {
  const state = getState();
  projects.set([...state.projects]);
}

// --- Mutations ---

/** Parse git remote URL from a .git/config file */
function parseRemoteUrl(gitConfig: string): string | undefined {
  const match = gitConfig.match(/\[remote "origin"\][\s\S]*?url\s*=\s*(.+)/);
  return match?.[1]?.trim();
}

/** Detect git info for a directory — returns gitBacked + optional remote */
async function detectGitInfo(
  path: string,
): Promise<{ gitBacked: boolean; remote?: string }> {
  try {
    const config = await invoke<string>("read_file", {
      path: `${path}/.git/config`,
    });
    return { gitBacked: true, remote: parseRemoteUrl(config) };
  } catch {
    return { gitBacked: false };
  }
}

/** Register a new project from a local directory path */
export async function registerProject(
  path: string,
  name: string,
): Promise<void> {
  const { gitBacked, remote } = await detectGitInfo(path);

  const projectId = uid();

  const state = getState();
  const color = nextProjectColor(state.projects);

  const project: ProjectState = {
    id: projectId,
    name,
    path,
    remote,
    gitBacked,
    active: true,
    color,
    workspaces: [],
  };

  stateAddProject(project);
  projects.update((list) => [...list, project]);
  await saveState();
}

/** Remove a project from state and store */
export async function unregisterProject(projectId: string): Promise<void> {
  let found = false;
  projects.update((list) => {
    const filtered = list.filter((p) => p.id !== projectId);
    found = filtered.length < list.length;
    return filtered;
  });

  if (found) {
    stateRemoveProject(projectId);
    await saveState();
  }
}

/** Set a project's active/inactive status */
export async function setProjectActive(
  projectId: string,
  active: boolean,
): Promise<void> {
  projects.update((list) =>
    list.map((p) => (p.id === projectId ? { ...p, active } : p)),
  );

  const state = getState();
  const proj = state.projects.find((p) => p.id === projectId);
  if (proj) proj.active = active;

  await saveState();
}

export async function setProjectColor(
  projectId: string,
  color: string,
): Promise<void> {
  projects.update((list) =>
    list.map((p) => (p.id === projectId ? { ...p, color } : p)),
  );

  const state = getState();
  const proj = state.projects.find((p) => p.id === projectId);
  if (proj) proj.color = color;

  await saveState();
}

export async function reorderProjects(
  fromIdx: number,
  toIdx: number,
): Promise<void> {
  stateReorderProjects(fromIdx, toIdx);
  projects.update((list) => {
    const [item] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, item);
    return [...list];
  });
  await saveState();
}

// --- Workspace Lifecycle ---

function refreshProjectStore(projectId: string): void {
  const state = getState();
  const project = state.projects.find((p) => p.id === projectId);
  if (!project) return;
  projects.update((list) => {
    const idx = list.findIndex((p) => p.id === projectId);
    if (idx >= 0)
      list[idx] = { ...project, workspaces: [...project.workspaces] };
    return [...list];
  });
}

export async function stashWorkspace(
  projectId: string,
  workspaceId: string,
): Promise<void> {
  updateWorkspaceStatus(projectId, workspaceId, "stashed");
  await saveState();
  refreshProjectStore(projectId);
}

export async function restoreWorkspace(
  projectId: string,
  workspaceId: string,
): Promise<void> {
  updateWorkspaceStatus(projectId, workspaceId, "active");
  await saveState();
  refreshProjectStore(projectId);
}

export async function archiveWorkspace(
  projectId: string,
  workspaceId: string,
  repoPath: string,
): Promise<void> {
  const state = getState();
  const project = state.projects.find((p) => p.id === projectId);
  const meta = project?.workspaces.find((w) => w.id === workspaceId);
  if (!meta) return;

  if (meta.branch) {
    const { showConfirmDialog } = await import("./dialog-service");
    const shouldPush = await showConfirmDialog(
      `Push branch "${meta.branch}" to remote before archiving?`,
      { title: "Archive Workspace", confirmLabel: "Push & Archive" },
    );
    if (shouldPush) {
      await pushBranch(repoPath, meta.branch);
    }
  }

  if (meta.worktreePath) {
    await removeWorktree(repoPath, meta.worktreePath);
  }

  updateWorkspaceStatus(projectId, workspaceId, "archived");
  await saveState();
  refreshProjectStore(projectId);
}

export async function deleteWorkspace(
  projectId: string,
  workspaceId: string,
): Promise<void> {
  removeWorkspace(projectId, workspaceId);
  await saveState();
  refreshProjectStore(projectId);
}
