/**
 * GnarTerm State System
 *
 * Runtime state lives in ~/.config/gnar/state.json (app-managed, not hand-editable).
 * Tracks projects, their workspaces, and floating workspaces.
 */

import { invoke } from "@tauri-apps/api/core";
import type { WorkspaceRecord, WorkspaceStatus } from "./types";
import { getHome, _resetHomeForTesting as _resetHome } from "./tauri-helpers";

// --- Types ---

export interface ProjectState {
  id: string;
  name: string;
  path: string;
  remote?: string;
  gitBacked: boolean;
  active: boolean;
  color: string;
  workspaces: WorkspaceRecord[];
}

/** Visually distinct palette for project identification in dark UIs */
export const PROJECT_COLORS = [
  "#e06c75", // red
  "#61afef", // blue
  "#98c379", // green
  "#e5c07b", // yellow
  "#c678dd", // purple
  "#56b6c2", // cyan
  "#d19a66", // orange
  "#be5046", // rust
  "#7ec8e3", // sky
  "#c3e88d", // lime
  "#ff79c6", // pink
  "#bd93f9", // lavender
];

export function nextProjectColor(existing: ProjectState[]): string {
  const used = new Set(existing.map((p) => p.color));
  return (
    PROJECT_COLORS.find((c) => !used.has(c)) ??
    PROJECT_COLORS[existing.length % PROJECT_COLORS.length]
  );
}

export interface AppState {
  projects: ProjectState[];
  floatingWorkspaces: WorkspaceRecord[];
}

// --- Defaults ---

export const DEFAULT_STATE: AppState = {
  projects: [],
  floatingWorkspaces: [],
};

// --- Internal state ---

let _state: AppState = structuredClone(DEFAULT_STATE);

function statePath(home: string): string {
  return `${home}/.config/gnar/state.json`;
}

// --- File I/O ---

export async function loadState(): Promise<AppState> {
  const home = await getHome();
  const path = statePath(home);

  try {
    const content = await invoke<string>("read_file", { path });
    const parsed = JSON.parse(content);
    const projects: ProjectState[] = Array.isArray(parsed.projects)
      ? parsed.projects
      : [];
    // Backfill fields for projects created before these features
    for (const p of projects) {
      if (!p.color)
        p.color = nextProjectColor(projects.filter((pp) => pp.color));
      if (p.gitBacked === undefined) p.gitBacked = true;
      // Migrate old workspace types
      for (const ws of p.workspaces) {
        if (
          (ws.type as string) === "project" ||
          (ws.type as string) === "personal" ||
          (ws.type as string) === "scratchpad"
        ) {
          ws.type = "terminal";
        }
        if ((ws.type as string) === "worktree") {
          ws.type = "managed";
        }
      }
    }
    const floatingWorkspaces: WorkspaceRecord[] = Array.isArray(
      parsed.floatingWorkspaces,
    )
      ? parsed.floatingWorkspaces
      : [];
    for (const ws of floatingWorkspaces) {
      if ((ws.type as string) === "scratchpad") ws.type = "terminal";
    }
    _state = {
      ...structuredClone(DEFAULT_STATE),
      ...parsed,
      projects,
      floatingWorkspaces,
    };
  } catch {
    _state = structuredClone(DEFAULT_STATE);
  }

  return _state;
}

export async function saveState(): Promise<void> {
  const home = await getHome();

  try {
    await invoke("ensure_dir", { path: `${home}/.config/gnar` });
  } catch {}

  await invoke("write_file", {
    path: statePath(home),
    content: JSON.stringify(_state, null, 2),
  });
}

export function getState(): AppState {
  return _state;
}

// --- Project CRUD ---

export function addProject(project: ProjectState): void {
  if (_state.projects.some((p) => p.id === project.id)) return;
  _state.projects.push(project);
}

export function removeProject(projectId: string): void {
  _state.projects = _state.projects.filter((p) => p.id !== projectId);
}

export function reorderProjects(fromIdx: number, toIdx: number): void {
  const arr = _state.projects;
  if (fromIdx < 0 || fromIdx >= arr.length || toIdx < 0 || toIdx >= arr.length)
    return;
  const [item] = arr.splice(fromIdx, 1);
  arr.splice(toIdx, 0, item);
}

// --- Reorder within sections ---

export function reorderWorkspacesInProject(
  projectId: string,
  fromIdx: number,
  toIdx: number,
): void {
  const project = _state.projects.find((p) => p.id === projectId);
  if (!project) return;
  const arr = project.workspaces;
  if (
    fromIdx < 0 ||
    fromIdx >= arr.length ||
    toIdx < 0 ||
    toIdx >= arr.length ||
    fromIdx === toIdx
  )
    return;
  const [item] = arr.splice(fromIdx, 1);
  arr.splice(toIdx, 0, item);
}

export function reorderFloatingWorkspaces(
  fromIdx: number,
  toIdx: number,
): void {
  const arr = _state.floatingWorkspaces;
  if (
    fromIdx < 0 ||
    fromIdx >= arr.length ||
    toIdx < 0 ||
    toIdx >= arr.length ||
    fromIdx === toIdx
  )
    return;
  const [item] = arr.splice(fromIdx, 1);
  arr.splice(toIdx, 0, item);
}

// --- Floating Workspace CRUD ---

export function addFloatingWorkspace(workspace: WorkspaceRecord): void {
  if (_state.floatingWorkspaces.some((w) => w.id === workspace.id)) return;
  _state.floatingWorkspaces.push(workspace);
}

export function removeFloatingWorkspace(workspaceId: string): void {
  _state.floatingWorkspaces = _state.floatingWorkspaces.filter(
    (w) => w.id !== workspaceId,
  );
}

export function updateFloatingWorkspaceStatus(
  workspaceId: string,
  status: WorkspaceStatus,
): void {
  const ws = _state.floatingWorkspaces.find((w) => w.id === workspaceId);
  if (ws) ws.status = status;
}

// --- Project Workspace CRUD ---

export function addWorkspace(
  projectId: string,
  workspace: WorkspaceRecord,
): void {
  const project = _state.projects.find((p) => p.id === projectId);
  if (!project) return;
  if (project.workspaces.some((w) => w.id === workspace.id)) return;
  project.workspaces.push(workspace);
}

export function removeWorkspace(projectId: string, workspaceId: string): void {
  const project = _state.projects.find((p) => p.id === projectId);
  if (!project) return;
  project.workspaces = project.workspaces.filter((w) => w.id !== workspaceId);
}

export function updateWorkspaceStatus(
  projectId: string,
  workspaceId: string,
  status: WorkspaceStatus,
): void {
  const project = _state.projects.find((p) => p.id === projectId);
  if (!project) return;
  const workspace = project.workspaces.find((w) => w.id === workspaceId);
  if (!workspace) return;
  workspace.status = status;
}

/** Reset module state — for tests only */
export function _resetForTesting(): void {
  _state = structuredClone(DEFAULT_STATE);
  _resetHome();
}
