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
 *
 * Lifecycle (start/stop/in-flight guard) lives in `createPoller`; this
 * module owns the per-tick body only.
 */
import { invoke } from "@tauri-apps/api/core";
import {
  listBranchDescriptors,
  updateBranchCommitState,
  isWipMessage,
} from "./branch-lifecycle";
import { createPoller, type PollerHandle } from "./create-poller";

const POLL_MS = 90_000;

// One-shot per-branch "did we already log a failure?" gate so a
// persistently broken `git_branch_commit_subjects` invocation doesn't
// spam the console on every tick.
const _warnedBranches = new Set<string>();

/**
 * One poll tick. Fans out one `git_branch_commit_subjects` call per
 * registered branch (skipping branches without a known baseBranch or
 * repoPath), classifies the subjects, and dispatches per-branch updates.
 */
export async function pollBranchCommitsOnce(
  invokeFn: typeof invoke = invoke,
): Promise<void> {
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
  } catch (err) {
    // Log the first failure per (repo, branch) so a regression in the
    // invoke surface doesn't silently produce permanently-stale lifecycle
    // data. Subsequent ticks stay quiet to avoid console spam.
    const key = `${repoPath}:${branch}`;
    if (!_warnedBranches.has(key)) {
      _warnedBranches.add(key);
      console.warn(
        `[branch-commits-poller] git_branch_commit_subjects failed for ${repoPath} ${base}..${branch}:`,
        err,
      );
    }
    return null;
  }
}

let _handle: PollerHandle | null = null;

/**
 * Start the poller. Returns a teardown function. Subsequent calls
 * destroy the previous instance — idempotent like initBranchLifecycle.
 */
export function startBranchCommitsPoller(
  invokeFn: typeof invoke = invoke,
): () => void {
  _handle = createPoller({
    intervalMs: POLL_MS,
    tick: () => pollBranchCommitsOnce(invokeFn),
  });
  return _handle.start();
}

export function stopBranchCommitsPoller(): void {
  _handle?.stop();
}

/** Test-only: reset the per-branch warn gate so warning tests start clean. */
export function _resetBranchCommitsPollerForTests(): void {
  _warnedBranches.clear();
  _handle?.stop();
  _handle = null;
}
