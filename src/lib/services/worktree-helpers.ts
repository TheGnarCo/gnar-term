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
  ctxWorkspacePath: unknown,
): Promise<string | null> {
  let repoPath: string | null;

  if (typeof ctxWorkspacePath === "string") {
    repoPath = ctxWorkspacePath;
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

export interface BaseOption {
  label: string;
  value: string;
  group?: string;
}

export interface BaseOptionsResult {
  options: BaseOption[];
  currentBranch: string | null;
}

/**
 * Build the Source Branch picker payload: locally-checked-out branches,
 * remote tracking branches, and branches currently checked out in a
 * worktree — each tagged with a group label for `<optgroup>` rendering,
 * sorted alphabetically within its group. Worktree branches always
 * follow the local + remote sections.
 *
 * Exported for unit testing.
 */
export async function fetchBaseOptions(
  repoPath: string,
): Promise<BaseOptionsResult> {
  const locals = new Map<string, BaseOption>();
  const remotes = new Map<string, BaseOption>();
  const worktreeNames = new Set<string>();
  let currentBranch: string | null = null;

  try {
    const branches = await invoke<BranchInfo[]>("list_branches", {
      repoPath,
      includeRemote: true,
    });
    for (const b of branches) {
      if (b.is_remote) {
        if (!remotes.has(b.name)) {
          remotes.set(b.name, {
            label: b.name,
            value: b.name,
            group: "Remote",
          });
        }
      } else {
        if (b.is_current) currentBranch = b.name;
        if (!locals.has(b.name)) {
          locals.set(b.name, {
            label: b.is_current ? `${b.name} (current)` : b.name,
            value: b.name,
            group: "Local",
          });
        }
      }
    }
  } catch {
    // list_branches unavailable — caller falls back to text input.
  }

  try {
    const worktrees = await invoke<WorktreeRef[]>("list_worktrees", {
      repoPath,
    });
    for (const wt of worktrees) {
      if (!wt.branch) continue;
      worktreeNames.add(wt.branch);
    }
  } catch {
    // list_worktrees unavailable — ignore, local/remote branches are enough.
  }

  const byName = (a: BaseOption, b: BaseOption) =>
    a.value.localeCompare(b.value);

  // Worktree-occupied branches are removed from their original section
  // and re-emitted in a trailing "Worktrees" group so the user can see
  // at a glance which branches are already checked out elsewhere.
  const localOpts: BaseOption[] = [];
  const remoteOpts: BaseOption[] = [];
  const worktreeOpts: BaseOption[] = [];

  for (const opt of locals.values()) {
    if (worktreeNames.has(opt.value)) {
      worktreeOpts.push({ ...opt, group: "Worktrees" });
    } else {
      localOpts.push(opt);
    }
  }
  for (const opt of remotes.values()) {
    if (worktreeNames.has(opt.value)) continue;
    remoteOpts.push(opt);
  }

  localOpts.sort(byName);
  remoteOpts.sort(byName);
  worktreeOpts.sort(byName);

  return {
    options: [...localOpts, ...remoteOpts, ...worktreeOpts],
    currentBranch,
  };
}

/**
 * Prompt the user for branch name and base branch, then derive the
 * worktree path. Returns null if the user cancels.
 */
export async function promptWorktreeConfig(
  repoPath: string,
  options?: { title?: string; branchPrefix?: string },
): Promise<WorktreeConfig | null> {
  const { options: baseOptions, currentBranch } =
    await fetchBaseOptions(repoPath);
  const defaultBase =
    (currentBranch &&
      baseOptions.find((o) => o.value === currentBranch)?.value) ||
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
          defaultValue: currentBranch ?? "main",
        } as const);

  const result = await showFormPrompt(
    options?.title || "New Branched Workspace",
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
