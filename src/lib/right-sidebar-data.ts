/**
 * Right sidebar data fetching — testable logic extracted from the Svelte component.
 *
 * Provides functions to fetch git status, commits, and determine whether
 * the right sidebar should be visible based on workspace metadata.
 */

import { invoke } from "@tauri-apps/api/core";
import type { WorkspaceRecord } from "./types";
import type { FileStatus, CommitInfo } from "./git";
import { gitStatus, gitLog } from "./git";

/**
 * Determine whether the right sidebar should be displayed.
 * Only available for workspaces attached to a project.
 */
export function shouldShowRightSidebar(
  meta: WorkspaceRecord | undefined,
): boolean {
  return !!meta?.projectId;
}

/**
 * Fetch changed files for a worktree.
 * Returns an empty array on error (e.g. path doesn't exist).
 */
export async function fetchChanges(
  worktreePath: string,
): Promise<FileStatus[]> {
  try {
    return await gitStatus(worktreePath);
  } catch {
    return [];
  }
}

/**
 * Fetch all non-hidden files recursively under a directory.
 * Returns an empty array on error.
 */
export async function fetchFiles(dirPath: string): Promise<string[]> {
  try {
    return await invoke<string[]>("list_files_recursive", { path: dirPath });
  } catch {
    return [];
  }
}

/**
 * Fetch commits ahead of the base branch for a worktree.
 * Returns an empty array on error.
 *
 * Not currently used in production UI, but exported as a tested utility
 * for future commit-log features (see right-sidebar.test.ts).
 */
export async function fetchCommits(
  worktreePath: string,
  baseBranch?: string,
): Promise<CommitInfo[]> {
  try {
    return await gitLog(worktreePath, baseBranch);
  } catch {
    return [];
  }
}
