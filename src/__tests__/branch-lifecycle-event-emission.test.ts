/**
 * Tests for the `branch:lifecycleChanged` event-bus emission emitted by
 * the branch-lifecycle service whenever a derived lifecycle value moves
 * (including first observation, where `from` is null).
 *
 * Extensions consume this event to react to transitions without
 * diffing the store on every tick.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));

vi.mock("../lib/services/gh-availability", () => ({
  isGhAvailable: vi.fn().mockResolvedValue(true),
}));

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

vi.mock("../lib/stores/workspace", async () => {
  const { writable: w } = await import("svelte/store");
  return {
    workspaces: w<unknown[]>([]),
    activeWorkspaceIdx: w(-1),
    activePseudoWorkspaceId: w(null),
    zoomedSurfaceId: w(null),
    workspaceHistory: w([null, null]),
    installSchedulePersist: () => undefined,
  };
});

vi.mock("../lib/config", () => ({
  getConfig: vi.fn(() => ({ agentDetection: {} })),
  saveConfig: vi.fn().mockResolvedValue(undefined),
}));

import {
  initBranchLifecycle,
  destroyBranchLifecycle,
  resetBranchLifecycleForTests,
  updateBranchPrState,
  _testHelpers,
} from "../lib/services/branch-lifecycle";
import { eventBus, type AppEvent } from "../lib/services/event-bus";

type LifecycleChangedEvent = Extract<
  AppEvent,
  { type: "branch:lifecycleChanged" }
>;

const NOW_MS = Date.UTC(2025, 5, 1, 12, 0, 0);

describe("branch-lifecycle: event emission", () => {
  let received: LifecycleChangedEvent[];
  let handler: (e: LifecycleChangedEvent) => void;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    resetBranchLifecycleForTests();
    received = [];
    handler = (e) => received.push(e);
    eventBus.on("branch:lifecycleChanged", handler);
  });

  afterEach(() => {
    eventBus.off("branch:lifecycleChanged", handler);
    destroyBranchLifecycle();
    vi.useRealTimers();
  });

  it("emits with from=null on first observation", async () => {
    initBranchLifecycle();
    await _testHelpers.seedBranch("branch-a", {
      repoPath: "/repo",
      branch: "feat/a",
      hasCommits: true,
      prState: null,
      lastActivityAt: NOW_MS,
      paneId: null,
    });

    const evt = received.find((e) => e.branchId === "branch-a");
    expect(evt).toBeDefined();
    expect(evt!.from).toBeNull();
    expect(evt!.to).toBe("awaiting_review");
  });

  it("emits with from=<previous> when the lifecycle transitions", async () => {
    initBranchLifecycle();
    await _testHelpers.seedBranch("branch-b", {
      repoPath: "/repo",
      branch: "feat/b",
      hasCommits: true,
      prState: null,
      lastActivityAt: NOW_MS,
      paneId: null,
    });
    // Initial: awaiting_review (commits, no PR, no agent running).
    received.length = 0;

    // Move to in_review by attaching an open non-draft PR.
    updateBranchPrState("branch-b", {
      state: "OPEN",
      isDraft: false,
      merged: false,
    });
    await Promise.resolve();

    const evt = received.find((e) => e.branchId === "branch-b");
    expect(evt).toBeDefined();
    expect(evt!.from).toBe("awaiting_review");
    expect(evt!.to).toBe("in_review");
  });

  it("does NOT emit when recompute produces the same lifecycle", async () => {
    initBranchLifecycle();
    await _testHelpers.seedBranch("branch-c", {
      repoPath: "/repo",
      branch: "feat/c",
      hasCommits: true,
      prState: null,
      lastActivityAt: NOW_MS,
      paneId: null,
    });
    received.length = 0;

    // Re-seed with same inputs — should be a no-op for the emission path.
    await _testHelpers.seedBranch("branch-c", {
      repoPath: "/repo",
      branch: "feat/c",
      hasCommits: true,
      prState: null,
      lastActivityAt: NOW_MS,
      paneId: null,
    });

    expect(received.filter((e) => e.branchId === "branch-c")).toHaveLength(0);
  });
});
