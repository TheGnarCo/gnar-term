/**
 * pr-state-poller — passive observer that feeds PR data into the
 * branchLifecycle derivation. Polls `gh pr list` per repo on a timer,
 * indexes PRs by `headRefName`, and calls `updateBranchPrState` for every
 * known branch in the registry.
 *
 * Also exports `repoOpenPrsStore`, a per-repo cache of open PRs used by
 * the workspace subtitle's PR row — that surface used to run its own 5s
 * `gh_list_prs` poller per visible row, which duplicated this poller's
 * work. Consumers register their repo root via `registerRepoForPrTracking`
 * so the poller picks up repos that have no branched worktrees.
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
 *
 * Lifecycle (start/stop/in-flight guard) lives in `createPoller`; this
 * module owns the per-tick body only.
 */
import { invoke } from "@tauri-apps/api/core";
import { writable, type Readable } from "svelte/store";
import { isGhAvailable } from "./gh-availability";
import {
  listBranchDescriptors,
  updateBranchPrState,
  type PrState,
} from "./branch-lifecycle";
import { createPoller, type PollerHandle } from "./create-poller";

const POLL_MS = 60_000;

/**
 * Open-PR shape published on `repoOpenPrsStore`. Mirrors the gh JSON
 * surface so UI rows can render `#N` links and titles without reshaping.
 */
export interface OpenPrListItem {
  number: number;
  title: string;
  state: string;
  url: string;
  headRefName: string;
  isDraft: boolean;
}

interface GhPr {
  number: number;
  title: string;
  state: string; // "OPEN" | "MERGED" | "CLOSED"
  url: string;
  headRefName: string;
  isDraft: boolean;
}

// One-shot per-repo "did we already log a failure?" gate so a persistently
// broken gh invocation doesn't spam the console on every tick.
const _warnedRepos = new Set<string>();

// Repo roots registered by surfaces that want PR data without owning a
// branched worktree (e.g. workspace subtitles on root workspaces).
const _registeredRepos = new Map<string, number>();

const _repoOpenPrsStore = writable<Map<string, OpenPrListItem[]>>(new Map());

/**
 * Per-repo open-PR list. Keyed by repoPath. Subscribers should treat a
 * missing key as "not yet fetched"; an empty array means "fetched, no
 * open PRs".
 */
export const repoOpenPrsStore: Readable<Map<string, OpenPrListItem[]>> = {
  subscribe: _repoOpenPrsStore.subscribe,
};

/**
 * Register a repoPath so the poller will fetch its PRs on every tick.
 * Refcounted so multiple mounts of the same surface cooperate. Returns
 * an unregister fn — symmetric with action-style helpers in this repo.
 */
export function registerRepoForPrTracking(repoPath: string): () => void {
  if (!repoPath) return () => {};
  _registeredRepos.set(repoPath, (_registeredRepos.get(repoPath) ?? 0) + 1);
  return () => {
    const count = _registeredRepos.get(repoPath);
    if (count === undefined) return;
    if (count <= 1) _registeredRepos.delete(repoPath);
    else _registeredRepos.set(repoPath, count - 1);
  };
}

/**
 * One poll tick. Groups branches by repoPath, queries `gh pr list` for
 * open + closed PRs per repo (closed includes merged), and dispatches
 * the per-branch update calls.
 */
export async function pollPrStateOnce(
  invokeFn: typeof invoke = invoke,
): Promise<void> {
  if (!(await isGhAvailable())) return;
  const branches = listBranchDescriptors();

  const byRepo = new Map<string, Array<{ branchId: string; branch: string }>>();
  for (const b of branches) {
    if (!b.repoPath) continue;
    const arr = byRepo.get(b.repoPath) ?? [];
    arr.push({ branchId: b.branchId, branch: b.branch });
    byRepo.set(b.repoPath, arr);
  }
  // Make sure repos registered by non-branch surfaces also tick so the
  // open-PR store stays populated for them.
  for (const repoPath of _registeredRepos.keys()) {
    if (!byRepo.has(repoPath)) byRepo.set(repoPath, []);
  }
  if (byRepo.size === 0) return;

  await Promise.all(
    [...byRepo.entries()].map(async ([repoPath, entries]) => {
      const result = await fetchPrsForRepo(repoPath, invokeFn);
      // When both gh calls failed we have no data to apply — leave the
      // prior cached PR state intact rather than clobbering it with null.
      if (!result) return;
      for (const { branchId, branch } of entries) {
        const pr = result.byBranch.get(branch) ?? null;
        updateBranchPrState(branchId, pr);
      }
      _repoOpenPrsStore.update((m) => {
        const next = new Map(m);
        next.set(repoPath, result.openList);
        return next;
      });
    }),
  );
}

async function fetchPrsForRepo(
  repoPath: string,
  invokeFn: typeof invoke,
): Promise<{
  byBranch: Map<string, PrState>;
  openList: OpenPrListItem[];
} | null> {
  const [open, closed] = await Promise.all([
    safeList(repoPath, "open", invokeFn),
    safeList(repoPath, "closed", invokeFn),
  ]);
  // Both calls failed — return null so the caller knows to leave prior
  // state intact rather than clobbering live PRs with empty results.
  if (open === null && closed === null) return null;
  const byBranch = new Map<string, PrState>();
  for (const pr of [...(open ?? []), ...(closed ?? [])]) {
    byBranch.set(pr.headRefName, prFromGh(pr));
  }
  const openList: OpenPrListItem[] = (open ?? [])
    .map((pr) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      url: pr.url,
      headRefName: pr.headRefName,
      isDraft: pr.isDraft,
    }))
    .sort((a, b) => b.number - a.number);
  return { byBranch, openList };
}

async function safeList(
  repoPath: string,
  state: "open" | "closed",
  invokeFn: typeof invoke,
): Promise<GhPr[] | null> {
  try {
    return await invokeFn<GhPr[]>("gh_list_prs", { repoPath, state });
  } catch (err) {
    // Log the first failure per repo so a regression in the invoke surface
    // doesn't silently produce permanently-stale lifecycle data. Subsequent
    // ticks stay quiet to avoid console spam on long-term outages.
    const key = `${repoPath}:${state}`;
    if (!_warnedRepos.has(key)) {
      _warnedRepos.add(key);
      console.warn(
        `[pr-state-poller] gh_list_prs failed for ${repoPath} (${state}):`,
        err,
      );
    }
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

let _handle: PollerHandle | null = null;

/**
 * Start the poller. Returns a teardown function. Subsequent calls
 * destroy the previous instance — idempotent like initBranchLifecycle.
 */
export function startPrStatePoller(
  invokeFn: typeof invoke = invoke,
): () => void {
  _handle = createPoller({
    intervalMs: POLL_MS,
    tick: () => pollPrStateOnce(invokeFn),
  });
  return _handle.start();
}

export function stopPrStatePoller(): void {
  _handle?.stop();
}

/** Test-only: reset the per-repo warn gate so warning tests start clean. */
export function _resetPrStatePollerForTests(): void {
  _warnedRepos.clear();
  _registeredRepos.clear();
  _repoOpenPrsStore.set(new Map());
  _handle?.stop();
  _handle = null;
}

/**
 * Test-only: seed the per-repo open-PR cache directly. Use this in
 * component tests to render a populated PR row without spinning the
 * actual poller (which has its own dedicated tests).
 */
export function _seedRepoOpenPrsForTests(
  repoPath: string,
  prs: OpenPrListItem[],
): void {
  _repoOpenPrsStore.update((m) => {
    const next = new Map(m);
    next.set(repoPath, prs);
    return next;
  });
}
