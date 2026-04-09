/**
 * UI State — visibility flags, navigation, and pending actions.
 * Dialog-specific stores live in dialog-service.ts.
 */
import { writable } from "svelte/store";
import type { MenuItem } from "../context-menu-types";

// --- Visibility flags ---

export const sidebarVisible = writable<boolean>(true);
export const commandPaletteOpen = writable<boolean>(false);
export const findBarVisible = writable<boolean>(false);
export const rightSidebarVisible = writable<boolean>(false);

// --- Context menu ---

export interface ContextMenuState {
  x: number;
  y: number;
  items: MenuItem[];
}
export const contextMenu = writable<ContextMenuState | null>(null);

// --- Pending action bus (terminal-service → App.svelte) ---

export type PendingAction =
  | { type: "open-preview"; payload: string }
  | { type: "split-right" }
  | { type: "split-down" }
  | { type: "open-diff"; payload: { worktreePath: string; filePath: string } }
  | {
      type: "open-commit";
      payload: {
        worktreePath: string;
        commit: { hash: string; shortHash: string; subject: string };
      };
    }
  | { type: "open-in-editor"; payload: string };
export const pendingAction = writable<PendingAction | null>(null);

// --- Loading state ---

export const loadingMessage = writable<string | null>(null);

// --- Navigation ---

export type ViewName =
  | "home"
  | "workspace"
  | "project"
  | "settings"
  | "project-settings";
export const currentView = writable<ViewName>("home");
export const currentProjectId = writable<string | null>(null);

export async function goHome(): Promise<void> {
  currentView.set("home");
  currentProjectId.set(null);
  const { activeWorkspaceIdx } = await import("./workspace");
  activeWorkspaceIdx.set(-1);
}

export async function goToProject(projectId: string): Promise<void> {
  currentView.set("project");
  currentProjectId.set(projectId);
  const { activeWorkspaceIdx } = await import("./workspace");
  activeWorkspaceIdx.set(-1);
}

export async function goToProjectSettings(projectId: string): Promise<void> {
  currentView.set("project-settings");
  currentProjectId.set(projectId);
  const { activeWorkspaceIdx } = await import("./workspace");
  activeWorkspaceIdx.set(-1);
}

export function openWorkspace(): void {
  currentView.set("workspace");
  currentProjectId.set(null);
}
