/**
 * Tests for branch-commits-poller — verifies it queries
 * `git_branch_commit_subjects` per registered branch, classifies the
 * results into hasCommits/wipOnly, and dispatches updateBranchCommitState
 * calls that drive the branchLifecycle derivation toward draft.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { get } from "svelte/store";

import { pollBranchCommitsOnce } from "../lib/services/branch-commits-poller";
import {
  branchLifecycleStore,
  _testHelpers,
  destroyBranchLifecycle,
} from "../lib/services/branch-lifecycle";

function makeInvoke(
  commitsByBranch: Record<string, string[]>,
): (
  cmd: string,
  args: { repoPath: string; base: string; branch: string },
) => Promise<unknown> {
  return async (cmd, args) => {
    if (cmd !== "git_branch_commit_subjects") {
      throw new Error(`unexpected command ${cmd}`);
    }
    return commitsByBranch[args.branch] ?? [];
  };
}

describe("branch-commits-poller", () => {
  beforeEach(() => {
    _testHelpers.clear();
  });

  afterEach(() => {
    destroyBranchLifecycle();
  });

  it("is a no-op when no branches are registered", async () => {
    const invokeFn = vi.fn();
    await pollBranchCommitsOnce(invokeFn);
    expect(invokeFn).not.toHaveBeenCalled();
  });

  it("skips branches without baseBranch", async () => {
    await _testHelpers.seedBranch("b1", {
      repoPath: "/repo",
      branch: "feat/x",
      // no baseBranch
      hasCommits: true,
      prState: null,
      lastActivityAt: Date.now(),
      paneId: null,
    });
    const invokeFn = vi.fn();
    await pollBranchCommitsOnce(invokeFn);
    expect(invokeFn).not.toHaveBeenCalled();
  });

  it("drives lifecycle to draft when branch has zero commits past base", async () => {
    await _testHelpers.seedBranch("b1", {
      repoPath: "/repo",
      branch: "feat/empty",
      baseBranch: "main",
      hasCommits: true, // start as if has commits
      prState: null,
      lastActivityAt: Date.now(),
      paneId: null,
    });
    const invokeFn = vi.fn(makeInvoke({ "feat/empty": [] }));

    await pollBranchCommitsOnce(invokeFn);

    expect(invokeFn).toHaveBeenCalledWith(
      "git_branch_commit_subjects",
      expect.objectContaining({
        repoPath: "/repo",
        base: "main",
        branch: "feat/empty",
      }),
    );
    const entry = get(branchLifecycleStore).get("b1");
    expect(entry?.lifecycle).toBe("draft");
  });

  it("drives lifecycle to draft when every commit is WIP-only", async () => {
    await _testHelpers.seedBranch("b1", {
      repoPath: "/repo",
      branch: "feat/wip",
      baseBranch: "main",
      hasCommits: false,
      prState: null,
      lastActivityAt: Date.now(),
      paneId: null,
    });
    const invokeFn = vi.fn(
      makeInvoke({
        "feat/wip": ["wip: tinkering", "WIP(thing): more"],
      }),
    );

    await pollBranchCommitsOnce(invokeFn);

    const entry = get(branchLifecycleStore).get("b1");
    expect(entry?.lifecycle).toBe("draft");
  });

  it("clears wipOnly when at least one commit is non-WIP", async () => {
    await _testHelpers.seedBranch("b1", {
      repoPath: "/repo",
      branch: "feat/mixed",
      baseBranch: "main",
      hasCommits: false,
      wipOnly: true,
      prState: null,
      lastActivityAt: Date.now(),
      paneId: null,
    });
    const invokeFn = vi.fn(
      makeInvoke({
        "feat/mixed": ["wip: tinkering", "feat: ship it"],
      }),
    );

    await pollBranchCommitsOnce(invokeFn);

    const entry = get(branchLifecycleStore).get("b1");
    // wipOnly cleared + hasCommits true → derivation should leave draft state
    expect(entry?.lifecycle).not.toBe("draft");
  });

  it("leaves prior state intact when the gh subprocess throws", async () => {
    await _testHelpers.seedBranch("b1", {
      repoPath: "/repo",
      branch: "feat/x",
      baseBranch: "main",
      hasCommits: true,
      wipOnly: false,
      prState: null,
      lastActivityAt: Date.now(),
      paneId: null,
    });
    const before = get(branchLifecycleStore).get("b1")?.lifecycle;
    const invokeFn = vi.fn().mockRejectedValue(new Error("git boom"));

    await expect(pollBranchCommitsOnce(invokeFn)).resolves.toBeUndefined();

    const after = get(branchLifecycleStore).get("b1")?.lifecycle;
    expect(after).toBe(before);
  });

  it("fans out one call per registered branch", async () => {
    await _testHelpers.seedBranch("b1", {
      repoPath: "/r",
      branch: "feat/a",
      baseBranch: "main",
      hasCommits: false,
      prState: null,
      lastActivityAt: Date.now(),
      paneId: null,
    });
    await _testHelpers.seedBranch("b2", {
      repoPath: "/r",
      branch: "feat/b",
      baseBranch: "main",
      hasCommits: false,
      prState: null,
      lastActivityAt: Date.now(),
      paneId: null,
    });
    const invokeFn = vi.fn(makeInvoke({}));

    await pollBranchCommitsOnce(invokeFn);

    expect(invokeFn).toHaveBeenCalledTimes(2);
  });
});
