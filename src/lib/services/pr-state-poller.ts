/**
 * pr-state-poller — passive observer that feeds PR data into the
 * branchLifecycle derivation. Polls `gh pr list` per repo on a timer,
 * indexes PRs by `headRefName`, and calls `updateBranchPrState` for every
 * known branch in the registry.
 *
 * Boundary note: this lives in core because it's pure passive observation
 * of remote git state — no UI, no orchestration. The branchLifecycleStore
 * is the canonical derived view; this poller is one of its inputs (alongside
 * the workspaces-store sync and the agent-state subscription).
 *
 * Polling cadence is intentionally generous (60s) — branch lifecycle moves
 * on the scale of minutes-to-days, not seconds. The first tick fires
 * immediately so newly-created branches resolve their `in_review`/`merged`
 * state without waiting a full interval.
 */
import { invoke } from "@tauri-apps/api/core";
import { isGhAvailable } from "./gh-availability";
import {
  listBranchDescriptors,
  updateBranchPrState,
  type PrState,
} from "./branch-lifecycle";

const POLL_MS = 60_000;

interface GhPr {
  number: number;
  title: string;
  state: string; // "OPEN" | "MERGED" | "CLOSED"
  headRefName: string;
  isDraft: boolean;
}

let _timer: ReturnType<typeof setInterval> | null = null;
let _inFlight = false;

/**
 * One poll tick. Groups branches by repoPath, queries `gh pr list` for
 * open + closed PRs per repo (closed includes merged), and dispatches
 * the per-branch update calls.
 */
export async function pollPrStateOnce(
  invokeFn: typeof invoke = invoke,
): Promise<void> {
  if (_inFlight) return;
  _inFlight = true;
  try {
    if (!(await isGhAvailable())) return;
    const branches = listBranchDescriptors();
    if (branches.length === 0) return;

    const byRepo = new Map<
      string,
      Array<{ branchId: string; branch: string }>
    >();
    for (const b of branches) {
      if (!b.repoPath) continue;
      const arr = byRepo.get(b.repoPath) ?? [];
      arr.push({ branchId: b.branchId, branch: b.branch });
      byRepo.set(b.repoPath, arr);
    }

    await Promise.all(
      [...byRepo.entries()].map(async ([repoPath, entries]) => {
        const result = await fetchPrsForRepo(repoPath, invokeFn);
        // When both gh calls failed we have no data to apply — leave the
        // prior cached PR state intact rather than clobbering it with null.
        if (!result) return;
        for (const { branchId, branch } of entries) {
          const pr = result.get(branch) ?? null;
          updateBranchPrState(branchId, pr);
        }
      }),
    );
  } finally {
    _inFlight = false;
  }
}

async function fetchPrsForRepo(
  repoPath: string,
  invokeFn: typeof invoke,
): Promise<Map<string, PrState> | null> {
  const [open, closed] = await Promise.all([
    safeList(repoPath, "open", invokeFn),
    safeList(repoPath, "closed", invokeFn),
  ]);
  // Both calls failed — return null so the caller knows to leave prior
  // state intact rather than clobbering live PRs with empty results.
  if (open === null && closed === null) return null;
  const map = new Map<string, PrState>();
  for (const pr of [...(open ?? []), ...(closed ?? [])]) {
    map.set(pr.headRefName, prFromGh(pr));
  }
  return map;
}

async function safeList(
  repoPath: string,
  state: "open" | "closed",
  invokeFn: typeof invoke,
): Promise<GhPr[] | null> {
  try {
    return await invokeFn<GhPr[]>("gh_list_prs", { repoPath, state });
  } catch {
    return null;
  }
}

function prFromGh(pr: GhPr): PrState {
  const raw = pr.state.toUpperCase();
  const state: PrState["state"] =
    raw === "MERGED" ? "MERGED" : raw === "CLOSED" ? "CLOSED" : "OPEN";
  return {
    state,
    isDraft: pr.isDraft,
    merged: state === "MERGED",
  };
}

/**
 * Start the poller. Returns a teardown function. Subsequent calls
 * destroy the previous instance — idempotent like initBranchLifecycle.
 */
export function startPrStatePoller(
  invokeFn: typeof invoke = invoke,
): () => void {
  stopPrStatePoller();
  void pollPrStateOnce(invokeFn);
  _timer = setInterval(() => void pollPrStateOnce(invokeFn), POLL_MS);
  return stopPrStatePoller;
}

export function stopPrStatePoller(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}
