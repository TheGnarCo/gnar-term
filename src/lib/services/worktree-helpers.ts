/**
 * Worktree helpers — repo validation, branch prompt, and worktree creation.
 *
 * Used by the core worktree-service. Calls Tauri invoke directly and uses
 * the core UI prompt stores so the helpers do not depend on an extension API.
 */
import { invoke } from "@tauri-apps/api/core";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { showFormPrompt } from "../stores/ui";

export interface WorktreeConfig {
  repoPath: string;
  branch: string;
  base: string;
  worktreePath: string;
}

async function pickDirectory(title: string): Promise<string | null> {
  const result = await dialogOpen({ directory: true, title });
  if (typeof result === "string") return result;
  return null;
}

/**
 * Resolve the repository path from context, prompting the user if needed.
 * Returns null if the user cancels or the path is not a git repo.
 */
export async function resolveRepoPath(
  ctxProjectPath: unknown,
): Promise<string | null> {
  let repoPath: string | null;

  if (typeof ctxProjectPath === "string") {
    repoPath = ctxProjectPath;
  } else {
    repoPath = await pickDirectory("Select Git Repository");
    if (!repoPath) return null;
  }

  const isGit = await invoke<boolean>("is_git_repo", { path: repoPath });
  if (!isGit) {
    await showFormPrompt("Error", [
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

async function fetchBaseOptions(
  repoPath: string,
): Promise<Array<{ label: string; value: string }>> {
  const seen = new Set<string>();
  const out: Array<{ label: string; value: string }> = [];

  try {
    const branches = await invoke<BranchInfo[]>("list_branches", {
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

  try {
    const worktrees = await invoke<WorktreeRef[]>("list_worktrees", {
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
 */
export async function promptWorktreeConfig(
  repoPath: string,
  options?: { title?: string; branchPrefix?: string },
): Promise<WorktreeConfig | null> {
  const baseOptions = await fetchBaseOptions(repoPath);
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

  const result = await showFormPrompt(
    options?.title || "New Worktree Workspace",
    [
      {
        key: "branch",
        label: "Branch Name",
        placeholder: "feature/my-branch",
        defaultValue: options?.branchPrefix || "",
      },
      baseField,
    ],
  );
  if (!result || !result.branch?.trim()) return null;

  const branch = result.branch.trim();
  const base = result.base?.trim() || "main";
  const worktreeName = branch.replace(/\//g, "-");
  const worktreePath = `${repoPath}/.gnar-term/worktrees/${worktreeName}`;

  return { repoPath, branch, base, worktreePath };
}

/**
 * Create a git worktree. Returns true on success, false on failure.
 */
export async function createWorktree(config: WorktreeConfig): Promise<boolean> {
  try {
    await invoke("create_worktree", {
      repoPath: config.repoPath,
      branch: config.branch,
      base: config.base,
      worktreePath: config.worktreePath,
    });
    return true;
  } catch (err) {
    await showFormPrompt("Failed to create worktree", [
      {
        key: "error",
        label: "Error",
        defaultValue: err instanceof Error ? err.message : String(err),
      },
    ]);
    return false;
  }
}
