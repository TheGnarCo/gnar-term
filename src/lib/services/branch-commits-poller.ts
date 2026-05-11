/**
 * branch-commits-poller — passive observer that feeds commit data into
 * the branchLifecycle derivation. Polls `git log base..branch` per
 * registered branch on a timer, classifies the commits as
 * `hasCommits` / `wipOnly`, and dispatches `updateBranchCommitState`.
 *
 * Boundary note: this lives in core because it's pure passive observation
 * of local git state — no UI, no orchestration. The branchLifecycleStore
 * is the canonical derived view; this poller is one of its inputs.
 *
 * Polling cadence is intentionally generous (90s) — commit churn on a
 * branch happens on the scale of minutes, not seconds. The first tick
 * fires immediately so newly-created branches resolve their draft state
 * without waiting a full interval.
 */
import { invoke } from "@tauri-apps/api/core";
import {
  listBranchDescriptors,
  updateBranchCommitState,
  isWipMessage,
} from "./branch-lifecycle";

const POLL_MS = 90_000;

let _timer: ReturnType<typeof setInterval> | null = null;
let _inFlight = false;

/**
 * One poll tick. Fans out one `git_branch_commit_subjects` call per
 * registered branch (skipping branches without a known baseBranch or
 * repoPath), classifies the subjects, and dispatches per-branch updates.
 */
export async function pollBranchCommitsOnce(
  invokeFn: typeof invoke = invoke,
): Promise<void> {
  if (_inFlight) return;
  _inFlight = true;
  try {
    const branches = listBranchDescriptors();
    if (branches.length === 0) return;

    await Promise.all(
      branches.map(async ({ branchId, repoPath, branch, baseBranch }) => {
        if (!repoPath || !baseBranch) return;
        const subjects = await safeListSubjects(
          repoPath,
          baseBranch,
          branch,
          invokeFn,
        );
        if (subjects === null) return;
        const hasCommits = subjects.length > 0;
        const wipOnly =
          subjects.length > 0 && subjects.every((s) => isWipMessage(s));
        updateBranchCommitState(branchId, hasCommits, wipOnly);
      }),
    );
  } finally {
    _inFlight = false;
  }
}

async function safeListSubjects(
  repoPath: string,
  base: string,
  branch: string,
  invokeFn: typeof invoke,
): Promise<string[] | null> {
  try {
    return await invokeFn<string[]>("git_branch_commit_subjects", {
      repoPath,
      base,
      branch,
    });
  } catch {
    return null;
  }
}

/**
 * Start the poller. Returns a teardown function. Subsequent calls
 * destroy the previous instance — idempotent like initBranchLifecycle.
 */
export function startBranchCommitsPoller(
  invokeFn: typeof invoke = invoke,
): () => void {
  stopBranchCommitsPoller();
  void pollBranchCommitsOnce(invokeFn);
  _timer = setInterval(() => void pollBranchCommitsOnce(invokeFn), POLL_MS);
  return stopBranchCommitsPoller;
}

export function stopBranchCommitsPoller(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}
