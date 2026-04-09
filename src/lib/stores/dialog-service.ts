/**
 * Dialog Service — Promise-backed imperative dialog drivers.
 *
 * Each dialog has a store (holds state while open) and a show function
 * (returns a Promise that resolves when the user submits or cancels).
 */
import { writable } from "svelte/store";

// --- Input Prompt ---

export interface InputPromptState {
  placeholder: string;
  defaultValue?: string;
  resolve: (value: string | null) => void;
}
export const inputPrompt = writable<InputPromptState | null>(null);

export function showInputPrompt(
  placeholder: string,
  defaultValue?: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    inputPrompt.set({ placeholder, defaultValue, resolve });
  });
}

// --- New Project Dialog ---

export interface NewProjectDialogState {
  resolve: (
    result:
      | { mode: "local"; path: string }
      | { mode: "remote"; url: string }
      | null,
  ) => void;
}
export const newProjectDialog = writable<NewProjectDialogState | null>(null);

export function showNewProjectDialog(): Promise<
  { mode: "local"; path: string } | { mode: "remote"; url: string } | null
> {
  return new Promise((resolve) => {
    newProjectDialog.set({ resolve });
  });
}

// --- New Workspace Dialog ---

export type NewWorkspaceResult =
  | { type: "terminal"; name: string }
  | { type: "managed"; branch: string; baseBranch: string }
  | { type: "existing-worktree"; worktreePath: string; branch: string }
  | null;

export interface NewWorkspaceDialogState {
  projectId: string;
  projectPath: string;
  gitBacked: boolean;
  branchPrefix: string;
  resolve: (result: NewWorkspaceResult) => void;
}
export const newWorkspaceDialog = writable<NewWorkspaceDialogState | null>(
  null,
);

export function showNewWorkspaceDialog(
  projectId: string,
  projectPath: string,
  gitBacked: boolean,
  branchPrefix: string,
): Promise<NewWorkspaceResult> {
  return new Promise((resolve) => {
    newWorkspaceDialog.set({
      projectId,
      projectPath,
      gitBacked,
      branchPrefix,
      resolve,
    });
  });
}

// --- Confirm Dialog ---

export interface ConfirmDialogState {
  message: string;
  title?: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (confirmed: boolean) => void;
}
export const confirmDialog = writable<ConfirmDialogState | null>(null);

export function showConfirmDialog(
  message: string,
  opts?: { title?: string; confirmLabel?: string; danger?: boolean },
): Promise<boolean> {
  return new Promise((resolve) => {
    confirmDialog.set({ message, ...opts, resolve });
  });
}

// --- Settings Dialog ---

export const settingsDialogOpen = writable<boolean>(false);
export const needsReload = writable<boolean>(false);
