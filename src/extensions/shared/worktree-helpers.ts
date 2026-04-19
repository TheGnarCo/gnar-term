/**
 * Shared worktree helpers for included extensions.
 *
 * These helpers deduplicate the repo-validation → branch-prompt →
 * worktree-creation flow used by worktree-workspaces (and available to
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

interface BranchInfo {
  name: string;
  is_current: boolean;
  is_remote: boolean;
}

interface WorktreeRef {
  path: string;
  head: string;
  branch: string | null;
  is_bare: boolean;
}

/**
 * Fetch the union of local branches, remote branches, and existing
 * worktree branches for the given repo. Returns an options array suitable
 * for a select field, grouped with prefixes so the user can tell them
 * apart. Falls back to empty on any failure (the caller should then show a
 * text input instead of a dropdown).
 */
async function fetchBaseOptions(
  api: ExtensionAPI,
  repoPath: string,
): Promise<Array<{ label: string; value: string }>> {
  const seen = new Set<string>();
  const out: Array<{ label: string; value: string }> = [];

  // Local branches first — these are the most common base choice.
  try {
    const branches = await api.invoke<BranchInfo[]>("list_branches", {
      repoPath,
      includeRemote: true,
    });
    const locals = branches.filter((b) => !b.is_remote);
    const remotes = branches.filter((b) => b.is_remote);
    for (const b of locals) {
      if (seen.has(b.name)) continue;
      seen.add(b.name);
      out.push({
        label: b.is_current ? `${b.name} (current)` : b.name,
        value: b.name,
      });
    }
    for (const b of remotes) {
      if (seen.has(b.name)) continue;
      seen.add(b.name);
      out.push({ label: `remote: ${b.name}`, value: b.name });
    }
  } catch {
    // list_branches unavailable — caller falls back to text input.
  }

  // Active worktrees contribute their branch names too, in case the user
  // wants to base a new worktree off one. Some worktrees are detached
  // (branch === null); skip those.
  try {
    const worktrees = await api.invoke<WorktreeRef[]>("list_worktrees", {
      repoPath,
    });
    for (const wt of worktrees) {
      if (!wt.branch || seen.has(wt.branch)) continue;
      seen.add(wt.branch);
      out.push({
        label: `worktree: ${wt.branch}`,
        value: wt.branch,
      });
    }
  } catch {
    // list_worktrees unavailable — ignore, local/remote branches are enough.
  }

  return out;
}

/**
 * Prompt the user for branch name and base branch, then derive the
 * worktree path. Returns null if the user cancels.
 *
 * When list_branches is available, the base field is a dropdown seeded
 * with local branches, remote branches, and existing worktree branches.
 * Falls back to a text input when the backend can't be reached.
 */
export async function promptWorktreeConfig(
  api: ExtensionAPI,
  repoPath: string,
  options?: { title?: string; branchPrefix?: string },
): Promise<WorktreeConfig | null> {
  const baseOptions = await fetchBaseOptions(api, repoPath);
  const defaultBase =
    baseOptions.find((o) => o.value === "main")?.value ||
    baseOptions.find((o) => o.value === "master")?.value ||
    baseOptions[0]?.value ||
    "main";

  const baseField =
    baseOptions.length > 0
      ? ({
          key: "base",
          label: "Source Branch",
          type: "select" as const,
          options: baseOptions,
          defaultValue: defaultBase,
        } as const)
      : ({
          key: "base",
          label: "Source Branch",
          defaultValue: "main",
        } as const);

  const result = await api.showFormPrompt(options?.title || "New Worktree", [
    {
      key: "branch",
      label: "Branch Name",
      placeholder: "feature/my-branch",
      defaultValue: options?.branchPrefix || "",
    },
    baseField,
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
