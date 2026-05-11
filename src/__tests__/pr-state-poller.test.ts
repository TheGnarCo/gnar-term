/**
 * Tests for pr-state-poller — verifies it queries `gh pr list` once per repo
 * (open + closed), maps results onto known branches, and dispatches
 * updateBranchPrState calls that drive the branchLifecycle derivation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { get } from "svelte/store";

const ghAvailableMock = vi.hoisted(() => vi.fn());
vi.mock("../lib/services/gh-availability", () => ({
  isGhAvailable: ghAvailableMock,
  invalidateGhAvailability: vi.fn(),
}));

import { pollPrStateOnce } from "../lib/services/pr-state-poller";
import {
  branchLifecycleStore,
  _testHelpers,
  destroyBranchLifecycle,
} from "../lib/services/branch-lifecycle";

interface GhPrFixture {
  number: number;
  title: string;
  state: string;
  headRefName: string;
  isDraft: boolean;
}

function makeInvoke(
  prsByRepo: Record<string, GhPrFixture[]>,
): (
  cmd: string,
  args: { repoPath: string; state: string },
) => Promise<unknown> {
  return async (cmd, args) => {
    if (cmd !== "gh_list_prs") {
      throw new Error(`unexpected command ${cmd}`);
    }
    const all = prsByRepo[args.repoPath] ?? [];
    if (args.state === "open") return all.filter((p) => p.state === "OPEN");
    if (args.state === "closed")
      return all.filter((p) => p.state === "MERGED" || p.state === "CLOSED");
    return [];
  };
}

describe("pr-state-poller", () => {
  beforeEach(() => {
    ghAvailableMock.mockReset();
    _testHelpers.clear();
  });

  afterEach(() => {
    destroyBranchLifecycle();
  });

  it("is a no-op when gh is unavailable (no invoke calls, no state change)", async () => {
    ghAvailableMock.mockResolvedValue(false);
    await _testHelpers.seedBranch("b1", {
      repoPath: "/repo",
      branch: "feat/x",
      hasCommits: true,
      prState: null,
      lastActivityAt: Date.now(),
      paneId: null,
    });
    const invokeFn = vi.fn();
    await pollPrStateOnce(invokeFn);
    expect(invokeFn).not.toHaveBeenCalled();
  });

  it("is a no-op when no branches are registered", async () => {
    ghAvailableMock.mockResolvedValue(true);
    const invokeFn = vi.fn();
    await pollPrStateOnce(invokeFn);
    expect(invokeFn).not.toHaveBeenCalled();
  });

  it("drives lifecycle to in_review for an OPEN non-draft PR", async () => {
    ghAvailableMock.mockResolvedValue(true);
    await _testHelpers.seedBranch("b1", {
      repoPath: "/repo",
      branch: "feat/x",
      hasCommits: true,
      prState: null,
      lastActivityAt: Date.now(),
      paneId: null,
    });
    const invokeFn = vi.fn(
      makeInvoke({
        "/repo": [
          {
            number: 42,
            title: "x",
            state: "OPEN",
            headRefName: "feat/x",
            isDraft: false,
          },
        ],
      }),
    );

    await pollPrStateOnce(invokeFn);

    const entry = get(branchLifecycleStore).get("b1");
    expect(entry?.lifecycle).toBe("in_review");
  });

  it("drives lifecycle to merged for a MERGED PR", async () => {
    ghAvailableMock.mockResolvedValue(true);
    await _testHelpers.seedBranch("b1", {
      repoPath: "/repo",
      branch: "feat/done",
      hasCommits: true,
      prState: null,
      lastActivityAt: Date.now(),
      paneId: null,
    });
    const invokeFn = vi.fn(
      makeInvoke({
        "/repo": [
          {
            number: 5,
            title: "done",
            state: "MERGED",
            headRefName: "feat/done",
            isDraft: false,
          },
        ],
      }),
    );

    await pollPrStateOnce(invokeFn);

    const entry = get(branchLifecycleStore).get("b1");
    expect(entry?.lifecycle).toBe("merged");
  });

  it("does NOT drive in_review for a draft PR (stays at prior lifecycle)", async () => {
    ghAvailableMock.mockResolvedValue(true);
    await _testHelpers.seedBranch("b1", {
      repoPath: "/repo",
      branch: "feat/draft",
      hasCommits: true,
      prState: null,
      lastActivityAt: Date.now(),
      paneId: null,
    });
    const invokeFn = vi.fn(
      makeInvoke({
        "/repo": [
          {
            number: 7,
            title: "wip",
            state: "OPEN",
            headRefName: "feat/draft",
            isDraft: true,
          },
        ],
      }),
    );

    await pollPrStateOnce(invokeFn);

    const entry = get(branchLifecycleStore).get("b1");
    expect(entry?.lifecycle).not.toBe("in_review");
    expect(entry?.lifecycle).not.toBe("merged");
  });

  it("groups branches by repoPath — one open + one closed call per repo", async () => {
    ghAvailableMock.mockResolvedValue(true);
    await _testHelpers.seedBranch("b1", {
      repoPath: "/r1",
      branch: "feat/a",
      hasCommits: true,
      prState: null,
      lastActivityAt: Date.now(),
      paneId: null,
    });
    await _testHelpers.seedBranch("b2", {
      repoPath: "/r1",
      branch: "feat/b",
      hasCommits: true,
      prState: null,
      lastActivityAt: Date.now(),
      paneId: null,
    });
    await _testHelpers.seedBranch("b3", {
      repoPath: "/r2",
      branch: "feat/c",
      hasCommits: true,
      prState: null,
      lastActivityAt: Date.now(),
      paneId: null,
    });
    const invokeFn = vi.fn(makeInvoke({}));

    await pollPrStateOnce(invokeFn);

    const repoCalls = invokeFn.mock.calls.map(
      (c) =>
        (c[1] as { repoPath: string }).repoPath +
        ":" +
        (c[1] as { state: string }).state,
    );
    expect(repoCalls.sort()).toEqual(
      ["/r1:closed", "/r1:open", "/r2:closed", "/r2:open"].sort(),
    );
  });

  it("swallows gh invoke errors and leaves prior state intact", async () => {
    ghAvailableMock.mockResolvedValue(true);
    await _testHelpers.seedBranch("b1", {
      repoPath: "/repo",
      branch: "feat/x",
      hasCommits: true,
      prState: { state: "OPEN", isDraft: false, merged: false },
      lastActivityAt: Date.now(),
      paneId: null,
    });
    const before = get(branchLifecycleStore).get("b1")?.lifecycle;
    const invokeFn = vi.fn().mockRejectedValue(new Error("gh boom"));

    await expect(pollPrStateOnce(invokeFn)).resolves.toBeUndefined();

    const after = get(branchLifecycleStore).get("b1")?.lifecycle;
    expect(after).toBe(before);
  });

  it("skips branches with no repoPath without throwing", async () => {
    ghAvailableMock.mockResolvedValue(true);
    await _testHelpers.seedBranch("b1", {
      repoPath: "",
      branch: "feat/x",
      hasCommits: true,
      prState: null,
      lastActivityAt: Date.now(),
      paneId: null,
    });
    const invokeFn = vi.fn();

    await pollPrStateOnce(invokeFn);

    expect(invokeFn).not.toHaveBeenCalled();
  });
});
