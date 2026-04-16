/**
 * Shared worktree helpers for included extensions.
 *
 * These helpers deduplicate the repo-validation → branch-prompt →
 * worktree-creation flow used by managed-workspaces (and available to
 * other extensions that need worktree operations). They use only the public ExtensionAPI surface.
 */
import type { ExtensionAPI } from "../api";

export interface WorktreeConfig {
  repoPath: string;
  branch: string;
  base: string;
  worktreePath: string;
}

/**
 * Resolve the repository path from context, prompting the user if needed.
 * Returns null if the user cancels or the path is not a git repo.
 */
export async function resolveRepoPath(
  api: ExtensionAPI,
  ctxProjectPath: unknown,
): Promise<string | null> {
  let repoPath: string | null;

  if (typeof ctxProjectPath === "string") {
    repoPath = ctxProjectPath;
  } else {
    repoPath = await api.pickDirectory("Select Git Repository");
    if (!repoPath) return null;
  }

  const isGit = await api.invoke<boolean>("is_git_repo", { path: repoPath });
  if (!isGit) {
    await api.showFormPrompt("Error", [
      {
        key: "error",
        label: `"${repoPath.split("/").pop()}" is not a git repository`,
        defaultValue: "Select a folder that contains a .git directory.",
      },
    ]);
    return null;
  }

  return repoPath;
}

/**
 * Prompt the user for branch name and base branch, then derive the
 * worktree path. Returns null if the user cancels.
 */
export async function promptWorktreeConfig(
  api: ExtensionAPI,
  repoPath: string,
  options?: { title?: string; branchPrefix?: string },
): Promise<WorktreeConfig | null> {
  const result = await api.showFormPrompt(options?.title || "New Worktree", [
    {
      key: "branch",
      label: "Branch Name",
      placeholder: "feature/my-branch",
      defaultValue: options?.branchPrefix || "",
    },
    {
      key: "base",
      label: "Base Branch",
      defaultValue: "main",
    },
  ]);
  if (!result || !result.branch?.trim()) return null;

  const branch = result.branch.trim();
  const base = result.base?.trim() || "main";
  const repoName = repoPath.split("/").pop() || "repo";
  const parentDir = repoPath.substring(0, repoPath.lastIndexOf("/"));
  const worktreePath = `${parentDir}/${repoName}-${branch.replace(/\//g, "-")}`;

  return { repoPath, branch, base, worktreePath };
}

/**
 * Create a git worktree. Returns true on success, false on failure
 * (shows an error dialog on failure).
 */
export async function createWorktree(
  api: ExtensionAPI,
  config: WorktreeConfig,
): Promise<boolean> {
  try {
    await api.invoke("create_worktree", {
      repoPath: config.repoPath,
      branch: config.branch,
      base: config.base,
      worktreePath: config.worktreePath,
    });
    return true;
  } catch (err) {
    await api.showFormPrompt("Failed to create worktree", [
      {
        key: "error",
        label: "Error",
        defaultValue: err instanceof Error ? err.message : String(err),
      },
    ]);
    return false;
  }
}
