/**
 * Tests for branch-lifecycle.ts — derived BranchLifecycle store.
 *
 * TDD: written before implementation (red → green → refactor).
 *
 * Each test covers one output state with the canonical input combination
 * from ADR-0004's decision table.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { get } from "svelte/store";

// ---------------------------------------------------------------------------
// Mock @tauri-apps/api/core so tests don't need a real Tauri runtime.
// ---------------------------------------------------------------------------
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));

// ---------------------------------------------------------------------------
// Mock gh-availability so we can control it per-test.
// ---------------------------------------------------------------------------
vi.mock("../lib/services/gh-availability", () => ({
  isGhAvailable: vi.fn().mockResolvedValue(true),
}));

// ---------------------------------------------------------------------------
// Mock worktree-service close path used by markAbandoned.
// ---------------------------------------------------------------------------
vi.mock("../lib/services/worktree-service", () => ({
  handleWorkspaceClosed: vi.fn().mockResolvedValue(undefined),
  getWorktreeEntries: vi.fn().mockReturnValue([]),
  worktreeEntriesStore: {
    subscribe: vi.fn((cb: (v: unknown[]) => void) => {
      cb([]);
      return () => undefined;
    }),
  },
  _resetWorktreeService: vi.fn(),
  confirmAndCloseWorkspace: vi.fn().mockResolvedValue(true),
}));

// ---------------------------------------------------------------------------
// Mock workspace store.
// ---------------------------------------------------------------------------
vi.mock("../lib/stores/workspace", async () => {
  const { writable: w } = await import("svelte/store");
  const _ws = w<unknown[]>([]);
  return {
    workspaces: _ws,
    activeWorkspaceIdx: w(-1),
    activePseudoWorkspaceId: w(null),
    zoomedSurfaceId: w(null),
    workspaceHistory: w([null, null]),
    installSchedulePersist: () => undefined,
  };
});

// ---------------------------------------------------------------------------
// Mock config.
// ---------------------------------------------------------------------------
vi.mock("../lib/config", () => ({
  getConfig: vi.fn(() => ({ agentDetection: {} })),
  saveConfig: vi.fn().mockResolvedValue(undefined),
}));

import { isGhAvailable } from "../lib/services/gh-availability";
import { invoke } from "@tauri-apps/api/core";
import {
  branchLifecycleStore,
  initBranchLifecycle,
  destroyBranchLifecycle,
  resetBranchLifecycleForTests,
  markAbandoned,
  _testHelpers,
} from "../lib/services/branch-lifecycle";
import { confirmAndCloseWorkspace } from "../lib/services/worktree-service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW_MS = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.clearAllMocks();
  resetBranchLifecycleForTests();
  // Default: gh available
  vi.mocked(isGhAvailable).mockResolvedValue(true);
  // Default: no commits
  vi.mocked(invoke).mockResolvedValue([]);
});

afterEach(() => {
  destroyBranchLifecycle();
});

// ---------------------------------------------------------------------------
// State: draft — no commits OR only WIP commits; no PR
// ---------------------------------------------------------------------------

describe("BranchLifecycle: draft", () => {
  it("branch with no commits and no PR → draft", async () => {
    vi.mocked(invoke).mockResolvedValue([]); // no commits
    vi.mocked(isGhAvailable).mockResolvedValue(true);

    initBranchLifecycle();
    await _testHelpers.seedBranch("branch-1", {
      repoPath: "/repo",
      branch: "my-feature",
      hasCommits: false,
      prState: null,
      lastActivityAt: NOW_MS,
      paneId: null,
    });

    const map = get(branchLifecycleStore);
    const entry = map.get("branch-1");
    expect(entry).toBeDefined();
    expect(entry?.lifecycle).toBe("draft");
    expect(entry?.prStateKnown).toBe(true);
  });

  it("branch with only WIP commit messages and no PR → draft", async () => {
    initBranchLifecycle();
    await _testHelpers.seedBranch("branch-wip", {
      repoPath: "/repo",
      branch: "wip-feature",
      hasCommits: true,
      wipOnly: true,
      prState: null,
      lastActivityAt: NOW_MS,
      paneId: null,
    });

    const map = get(branchLifecycleStore);
    const entry = map.get("branch-wip");
    expect(entry?.lifecycle).toBe("draft");
  });
});

// ---------------------------------------------------------------------------
// State: active — AgentState is running in the branch's pane
// ---------------------------------------------------------------------------

describe("BranchLifecycle: active", () => {
  it("agent running in branch pane → active", async () => {
    initBranchLifecycle();
    await _testHelpers.seedBranch("branch-2", {
      repoPath: "/repo",
      branch: "feat/active",
      hasCommits: true,
      prState: null,
      lastActivityAt: NOW_MS,
      paneId: "pane-a",
    });
    // Inject running agent state into the pane
    await _testHelpers.setPaneAgentState("pane-a", "running");

    const map = get(branchLifecycleStore);
    const entry = map.get("branch-2");
    expect(entry?.lifecycle).toBe("active");
  });

  it("agent NOT running → does not return active", async () => {
    initBranchLifecycle();
    await _testHelpers.seedBranch("branch-3", {
      repoPath: "/repo",
      branch: "feat/idle",
      hasCommits: true,
      prState: null,
      lastActivityAt: NOW_MS,
      paneId: "pane-b",
    });
    await _testHelpers.setPaneAgentState("pane-b", "idle");

    const map = get(branchLifecycleStore);
    const entry = map.get("branch-3");
    expect(entry?.lifecycle).not.toBe("active");
  });
});

// ---------------------------------------------------------------------------
// State: awaiting_review — commits present; not running; no PR or draft PR
// ---------------------------------------------------------------------------

describe("BranchLifecycle: awaiting_review", () => {
  it("commits present, agent idle, no PR → awaiting_review", async () => {
    initBranchLifecycle();
    await _testHelpers.seedBranch("branch-4", {
      repoPath: "/repo",
      branch: "feat/ready",
      hasCommits: true,
      prState: null,
      lastActivityAt: NOW_MS,
      paneId: "pane-c",
    });
    _testHelpers.setPaneAgentState("pane-c", "idle");

    const map = get(branchLifecycleStore);
    const entry = map.get("branch-4");
    expect(entry?.lifecycle).toBe("awaiting_review");
  });

  it("commits present, agent idle, draft PR → awaiting_review", async () => {
    initBranchLifecycle();
    await _testHelpers.seedBranch("branch-5", {
      repoPath: "/repo",
      branch: "feat/draft-pr",
      hasCommits: true,
      prState: { state: "OPEN", isDraft: true, merged: false },
      lastActivityAt: NOW_MS,
      paneId: null,
    });

    const map = get(branchLifecycleStore);
    const entry = map.get("branch-5");
    expect(entry?.lifecycle).toBe("awaiting_review");
  });
});

// ---------------------------------------------------------------------------
// State: in_review — PR open and non-draft
// ---------------------------------------------------------------------------

describe("BranchLifecycle: in_review", () => {
  it("PR open and non-draft → in_review", async () => {
    initBranchLifecycle();
    await _testHelpers.seedBranch("branch-6", {
      repoPath: "/repo",
      branch: "feat/in-review",
      hasCommits: true,
      prState: { state: "OPEN", isDraft: false, merged: false },
      lastActivityAt: NOW_MS,
      paneId: null,
    });

    const map = get(branchLifecycleStore);
    const entry = map.get("branch-6");
    expect(entry?.lifecycle).toBe("in_review");
    expect(entry?.prStateKnown).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// State: merged — PR merged
// ---------------------------------------------------------------------------

describe("BranchLifecycle: merged", () => {
  it("PR merged → merged", async () => {
    initBranchLifecycle();
    await _testHelpers.seedBranch("branch-7", {
      repoPath: "/repo",
      branch: "feat/merged",
      hasCommits: true,
      prState: { state: "MERGED", isDraft: false, merged: true },
      lastActivityAt: NOW_MS,
      paneId: null,
    });

    const map = get(branchLifecycleStore);
    const entry = map.get("branch-7");
    expect(entry?.lifecycle).toBe("merged");
    expect(entry?.prStateKnown).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// State: abandoned — no activity > N days; no PR; agent idle
// ---------------------------------------------------------------------------

describe("BranchLifecycle: abandoned", () => {
  it("no activity > 14 days, no PR, agent idle → abandoned", async () => {
    initBranchLifecycle();
    const staleTime = NOW_MS - 15 * DAY_MS;
    await _testHelpers.seedBranch("branch-8", {
      repoPath: "/repo",
      branch: "feat/stale",
      hasCommits: true,
      prState: null,
      lastActivityAt: staleTime,
      paneId: "pane-d",
    });
    _testHelpers.setPaneAgentState("pane-d", "idle");

    const map = get(branchLifecycleStore);
    const entry = map.get("branch-8");
    expect(entry?.lifecycle).toBe("abandoned");
  });

  it("no activity > N days but recent activity (13 days) → NOT abandoned", async () => {
    initBranchLifecycle();
    const recentTime = NOW_MS - 13 * DAY_MS;
    await _testHelpers.seedBranch("branch-9", {
      repoPath: "/repo",
      branch: "feat/recent",
      hasCommits: true,
      prState: null,
      lastActivityAt: recentTime,
      paneId: null,
    });

    const map = get(branchLifecycleStore);
    const entry = map.get("branch-9");
    expect(entry?.lifecycle).not.toBe("abandoned");
  });
});

// ---------------------------------------------------------------------------
// gh unavailable: in_review / merged collapse to awaiting_review
// ---------------------------------------------------------------------------

describe("BranchLifecycle: gh-unavailable fallback", () => {
  it("in_review collapses to awaiting_review when gh unavailable", async () => {
    vi.mocked(isGhAvailable).mockResolvedValue(false);
    initBranchLifecycle();
    await _testHelpers.seedBranch("branch-gh-1", {
      repoPath: "/repo",
      branch: "feat/no-gh-open",
      hasCommits: true,
      prState: { state: "OPEN", isDraft: false, merged: false },
      lastActivityAt: NOW_MS,
      paneId: null,
    });

    const map = get(branchLifecycleStore);
    const entry = map.get("branch-gh-1");
    expect(entry?.lifecycle).toBe("awaiting_review");
    expect(entry?.prStateKnown).toBe(false);
  });

  it("merged collapses to awaiting_review when gh unavailable", async () => {
    vi.mocked(isGhAvailable).mockResolvedValue(false);
    initBranchLifecycle();
    await _testHelpers.seedBranch("branch-gh-2", {
      repoPath: "/repo",
      branch: "feat/no-gh-merged",
      hasCommits: true,
      prState: { state: "MERGED", isDraft: false, merged: true },
      lastActivityAt: NOW_MS,
      paneId: null,
    });

    const map = get(branchLifecycleStore);
    const entry = map.get("branch-gh-2");
    expect(entry?.lifecycle).toBe("awaiting_review");
    expect(entry?.prStateKnown).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// markAbandoned action
// ---------------------------------------------------------------------------

describe("markAbandoned", () => {
  it("invokes confirmAndCloseWorkspace for the branch's workspace", async () => {
    vi.mocked(confirmAndCloseWorkspace).mockResolvedValue(true);

    initBranchLifecycle();
    await _testHelpers.seedBranch("branch-abandon", {
      repoPath: "/repo",
      branch: "feat/abandon",
      hasCommits: false,
      prState: null,
      lastActivityAt: NOW_MS,
      paneId: null,
      workspaceId: "ws-abandon",
    });

    await markAbandoned("branch-abandon");

    // Should have called confirmAndCloseWorkspace (the close path)
    expect(confirmAndCloseWorkspace).toHaveBeenCalled();
  });

  it("does not directly mutate the derived store state", async () => {
    initBranchLifecycle();
    await _testHelpers.seedBranch("branch-no-mutate", {
      repoPath: "/repo",
      branch: "feat/no-mutate",
      hasCommits: false,
      prState: null,
      lastActivityAt: NOW_MS,
      paneId: null,
    });

    const before = get(branchLifecycleStore).get("branch-no-mutate")?.lifecycle;
    await markAbandoned("branch-no-mutate");
    // State is derived — markAbandoned triggers a close action, not a store write
    // After the action the store stays derived from inputs (here still 'draft')
    const after = get(branchLifecycleStore).get("branch-no-mutate")?.lifecycle;
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Memoization — recomputing only on relevant input changes
// ---------------------------------------------------------------------------

describe("BranchLifecycle: memoization", () => {
  it("changing an unrelated branch does not recompute an unchanged branch's entry reference", async () => {
    initBranchLifecycle();
    await _testHelpers.seedBranch("branch-memo-1", {
      repoPath: "/repo",
      branch: "stable",
      hasCommits: true,
      prState: null,
      lastActivityAt: NOW_MS,
      paneId: null,
    });

    const mapBefore = get(branchLifecycleStore);
    const entryBefore = mapBefore.get("branch-memo-1");

    // Seed a second branch — should not change the first branch's entry object
    await _testHelpers.seedBranch("branch-memo-2", {
      repoPath: "/repo",
      branch: "another",
      hasCommits: false,
      prState: null,
      lastActivityAt: NOW_MS,
      paneId: null,
    });

    const mapAfter = get(branchLifecycleStore);
    const entryAfter = mapAfter.get("branch-memo-1");

    // Same object reference if memoized correctly
    expect(entryAfter).toBe(entryBefore);
  });
});

// ---------------------------------------------------------------------------
// abandonedAfterDays config override
// ---------------------------------------------------------------------------

describe("BranchLifecycle: abandonedAfterDays config", () => {
  it("abandonedAfterDays=1 marks a branch stale after 1 day", async () => {
    const { getConfig } = await import("../lib/config");
    vi.mocked(getConfig).mockReturnValue({
      agentDetection: { abandonedAfterDays: 1 },
    } as unknown as ReturnType<typeof getConfig>);

    initBranchLifecycle();
    const staleTime = NOW_MS - 2 * DAY_MS; // 2 days ago — beyond 1-day threshold
    await _testHelpers.seedBranch("branch-config-1", {
      repoPath: "/repo",
      branch: "feat/short-threshold",
      hasCommits: true,
      prState: null,
      lastActivityAt: staleTime,
      paneId: "pane-config",
    });
    _testHelpers.setPaneAgentState("pane-config", "idle");

    const map = get(branchLifecycleStore);
    const entry = map.get("branch-config-1");
    expect(entry?.lifecycle).toBe("abandoned");
  });

  it("abandonedAfterDays=1 does NOT mark a branch stale at 12 hours", async () => {
    const { getConfig } = await import("../lib/config");
    vi.mocked(getConfig).mockReturnValue({
      agentDetection: { abandonedAfterDays: 1 },
    } as unknown as ReturnType<typeof getConfig>);

    initBranchLifecycle();
    const recentTime = NOW_MS - 12 * 60 * 60 * 1000; // 12h ago
    await _testHelpers.seedBranch("branch-config-2", {
      repoPath: "/repo",
      branch: "feat/fresh",
      hasCommits: true,
      prState: null,
      lastActivityAt: recentTime,
      paneId: null,
    });

    const map = get(branchLifecycleStore);
    const entry = map.get("branch-config-2");
    expect(entry?.lifecycle).not.toBe("abandoned");
  });
});

// ---------------------------------------------------------------------------
// initBranchLifecycle / destroyBranchLifecycle lifecycle management
// ---------------------------------------------------------------------------

describe("BranchLifecycle: service lifecycle", () => {
  it("initBranchLifecycle is idempotent — second call tears down first", () => {
    initBranchLifecycle();
    // Should not throw
    expect(() => initBranchLifecycle()).not.toThrow();
  });

  it("destroyBranchLifecycle clears the store", async () => {
    initBranchLifecycle();
    await _testHelpers.seedBranch("branch-destroy", {
      repoPath: "/repo",
      branch: "feat/destroy",
      hasCommits: false,
      prState: null,
      lastActivityAt: NOW_MS,
      paneId: null,
    });

    destroyBranchLifecycle();
    const map = get(branchLifecycleStore);
    expect(map.size).toBe(0);
  });
});
