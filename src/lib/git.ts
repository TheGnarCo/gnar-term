/**
 * Git operations — typed wrappers over Tauri invoke calls.
 *
 * These functions correspond to the Rust #[tauri::command] functions
 * in src-tauri/src/lib.rs. The TS types mirror the Rust serde structs.
 */

import { invoke } from "@tauri-apps/api/core";

// --- Types (mirror Rust serde structs — camelCase via Tauri's rename) ---

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
  isBare: boolean;
}

export interface BranchInfo {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  head: string;
}

export interface FileStatus {
  path: string;
  indexStatus: string;
  workStatus: string;
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: string;
}

// --- Clone ---

export async function cloneProject(
  url: string,
  targetDir: string,
): Promise<void> {
  await invoke("git_clone", { url, targetDir });
}

// --- Checkout ---

export async function gitCheckout(
  repoPath: string,
  branch: string,
): Promise<void> {
  return invoke("git_checkout", { repoPath, branch });
}

// --- Worktree operations ---

export async function createWorktree(
  repoPath: string,
  branch: string,
  base: string,
  worktreeBaseDir?: string,
): Promise<string> {
  return invoke<string>("create_worktree", {
    repoPath,
    branch,
    base,
    worktreeBaseDir: worktreeBaseDir ?? null,
  });
}

export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
): Promise<void> {
  return invoke("remove_worktree", { repoPath, worktreePath });
}

export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  return invoke<WorktreeInfo[]>("list_worktrees", { repoPath });
}

// --- Branch operations ---

export async function fetchAll(repoPath: string): Promise<void> {
  return invoke("git_fetch_all", { repoPath });
}

export async function listBranches(
  repoPath: string,
  includeRemote = false,
): Promise<BranchInfo[]> {
  return invoke<BranchInfo[]>("list_branches", { repoPath, includeRemote });
}

export async function pushBranch(
  repoPath: string,
  branch: string,
): Promise<void> {
  return invoke("push_branch", { repoPath, branch });
}

export async function deleteBranch(
  repoPath: string,
  branch: string,
  remote: boolean,
): Promise<void> {
  return invoke("delete_branch", { repoPath, branch, remote });
}

// --- Diff / status / log ---

export async function gitStatus(worktreePath: string): Promise<FileStatus[]> {
  return invoke<FileStatus[]>("git_status", { worktreePath });
}

export async function gitDiff(
  worktreePath: string,
  path?: string,
): Promise<string> {
  return invoke<string>("git_diff", { worktreePath, path: path ?? null });
}

export async function gitLog(
  worktreePath: string,
  baseBranch?: string,
): Promise<CommitInfo[]> {
  return invoke<CommitInfo[]>("git_log", {
    worktreePath,
    baseBranch: baseBranch ?? null,
  });
}

export async function gitLsFiles(worktreePath: string): Promise<string[]> {
  return invoke<string[]>("git_ls_files", { worktreePath });
}

// --- GitHub CLI integration ---

export interface GhIssue {
  number: number;
  title: string;
  state: string;
  author: string;
  labels: string[];
  url: string;
  createdAt: string;
  updatedAt: string;
}

export async function ghListIssues(
  repoPath: string,
  state?: string,
): Promise<GhIssue[]> {
  return invoke<GhIssue[]>("gh_list_issues", {
    repoPath,
    state: state ?? null,
  });
}

export interface GhPullRequest {
  number: number;
  title: string;
  state: string;
  author: string;
  headRef: string;
  labels: string[];
  url: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function ghListPrs(
  repoPath: string,
  state?: string,
): Promise<GhPullRequest[]> {
  return invoke<GhPullRequest[]>("gh_list_prs", {
    repoPath,
    state: state ?? null,
  });
}

// --- PR workflow commands ---

export async function gitAdd(
  worktreePath: string,
  paths: string[] = [],
): Promise<void> {
  return invoke("git_add", { worktreePath, paths });
}

export async function gitCommit(
  worktreePath: string,
  message: string,
): Promise<string> {
  return invoke<string>("git_commit", { worktreePath, message });
}

export async function gitPush(worktreePath: string): Promise<string> {
  return invoke<string>("git_push", { worktreePath });
}

export async function gitPull(worktreePath: string): Promise<string> {
  return invoke<string>("git_pull", { worktreePath });
}

export async function gitRevListCount(
  worktreePath: string,
  branch: string,
  remoteBranch: string,
): Promise<string> {
  return invoke<string>("git_rev_list_count", {
    worktreePath,
    branch,
    remoteBranch,
  });
}

export async function gitBranchName(worktreePath: string): Promise<string> {
  return invoke<string>("git_branch_name", { worktreePath });
}

export async function gitDiffStaged(worktreePath: string): Promise<string> {
  return invoke<string>("git_diff_staged", { worktreePath });
}

export async function ghCreatePr(
  repoPath: string,
  title: string,
  body?: string,
  base?: string,
  draft?: boolean,
): Promise<string> {
  return invoke<string>("gh_create_pr", {
    repoPath,
    title,
    body: body ?? null,
    base: base ?? null,
    draft: draft ?? false,
  });
}

// --- Worktree lifecycle commands ---

export async function runScript(cwd: string, command: string): Promise<string> {
  return invoke<string>("run_script", { cwd, command });
}

export async function copyFiles(
  sourceDir: string,
  destDir: string,
  patterns: string[],
): Promise<string[]> {
  return invoke<string[]>("copy_files", { sourceDir, destDir, patterns });
}
