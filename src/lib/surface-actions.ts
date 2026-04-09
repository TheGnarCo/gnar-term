/**
 * Surface lifecycle — pure factory functions for creating Surface objects.
 *
 * These functions build Surface data structures (diff, filebrowser, commithistory,
 * preview) without reading Svelte stores. The caller is responsible for adding
 * the returned surface to a pane and triggering store notifications.
 */

import { uid } from "./types";
import type {
  Surface,
  DiffSurface,
  FileBrowserSurface,
  CommitHistorySurface,
} from "./types";
import { gitDiff, gitLog, gitLsFiles } from "./git";

/**
 * Create a diff surface for a worktree, optionally scoped to a single file.
 *
 * Used by both the contextual surface switcher and the "open diff in pane" action.
 */
export async function createDiffSurface(
  worktreePath: string,
  filePath?: string,
): Promise<DiffSurface> {
  const diffContent = await gitDiff(worktreePath, filePath).catch(() => "");
  return {
    kind: "diff",
    id: uid(),
    title: filePath
      ? `Diff: ${filePath.split("/").pop()}`
      : "Working Tree Diff",
    worktreePath,
    filePath,
    diffContent,
    hasUnread: false,
  };
}

/**
 * Create a diff surface showing a specific commit's changes.
 */
export async function createCommitDiffSurface(
  worktreePath: string,
  commit: { hash: string; shortHash: string; subject: string },
): Promise<DiffSurface> {
  const diffContent = await gitDiff(worktreePath, commit.hash).catch(() => "");
  return {
    kind: "diff",
    id: uid(),
    title: `${commit.shortHash}: ${commit.subject}`,
    worktreePath,
    diffContent,
    hasUnread: false,
  };
}

/**
 * Create a file browser surface listing tracked files in a worktree.
 */
export async function createFileBrowserSurface(
  worktreePath: string,
): Promise<FileBrowserSurface> {
  const files = await gitLsFiles(worktreePath).catch(() => []);
  return {
    kind: "filebrowser",
    id: uid(),
    title: "Files",
    worktreePath,
    files,
    hasUnread: false,
  };
}

/**
 * Create a commit history surface for a worktree.
 */
export async function createCommitHistorySurface(
  worktreePath: string,
  baseBranch?: string,
): Promise<CommitHistorySurface> {
  const commits = await gitLog(worktreePath, baseBranch).catch(() => []);
  return {
    kind: "commithistory",
    id: uid(),
    title: "Commits",
    worktreePath,
    baseBranch,
    commits,
    hasUnread: false,
  };
}

/**
 * Create a contextual surface by kind. Dispatches to the appropriate factory.
 *
 * Returns null for unrecognized kinds.
 */
export async function createContextualSurface(
  kind: string,
  worktreePath: string,
  baseBranch?: string,
): Promise<Surface | null> {
  if (kind === "diff") {
    return createDiffSurface(worktreePath);
  } else if (kind === "filebrowser") {
    return createFileBrowserSurface(worktreePath);
  } else if (kind === "commithistory") {
    return createCommitHistorySurface(worktreePath, baseBranch);
  }
  return null;
}
