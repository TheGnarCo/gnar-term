/**
 * Tests for the lastActivityAt bump fed by paneAgentStateStore transitions.
 *
 * The subscription path in initBranchLifecycle walks every registered
 * branch on each store tick, looks up the matching pane's
 * `transitionedAt`, and calls bumpBranchActivity with that timestamp.
 * A stale-createdAt branch whose pane has a recent transition should
 * therefore NOT classify as abandoned.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { get, type Writable } from "svelte/store";

const NOW_MS = Date.UTC(2025, 5, 1, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

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

vi.mock("../lib/config", () => ({
  getConfig: vi.fn(() => ({ agentDetection: {} })),
  saveConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/services/agent-detection-service", async () => {
  const { writable } = await import("svelte/store");
  return {
    paneAgentStateStore: writable(new Map()),
  };
});

import {
  branchLifecycleStore,
  initBranchLifecycle,
  destroyBranchLifecycle,
  _testHelpers,
} from "../lib/services/branch-lifecycle";

type PaneStateMap = Map<string, { state: string; transitionedAt: string }>;

let paneStore: Writable<PaneStateMap>;

describe("BranchLifecycle: lastActivityAt bump from pane agent transitions", () => {
  beforeAll(async () => {
    const mod = (await import("../lib/services/agent-detection-service")) as {
      paneAgentStateStore: Writable<PaneStateMap>;
    };
    paneStore = mod.paneAgentStateStore;
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    paneStore.set(new Map());
    _testHelpers.clear();
  });

  afterEach(() => {
    destroyBranchLifecycle();
    vi.useRealTimers();
  });

  it("stale-createdAt branch with recent agent transition does NOT classify as abandoned", async () => {
    initBranchLifecycle();
    const staleTime = NOW_MS - 30 * DAY_MS;
    await _testHelpers.seedBranch("branch-stale", {
      repoPath: "/repo",
      branch: "feat/stale",
      hasCommits: true,
      prState: null,
      lastActivityAt: staleTime,
      paneId: "pane-a",
    });

    expect(get(branchLifecycleStore).get("branch-stale")?.lifecycle).toBe(
      "abandoned",
    );

    paneStore.set(
      new Map([
        [
          "pane-a",
          {
            state: "running",
            transitionedAt: new Date(NOW_MS - 1000).toISOString(),
          },
        ],
      ]),
    );
    await Promise.resolve();

    expect(get(branchLifecycleStore).get("branch-stale")?.lifecycle).not.toBe(
      "abandoned",
    );
  });

  it("does not bump when the pane has no entry", async () => {
    initBranchLifecycle();
    const staleTime = NOW_MS - 30 * DAY_MS;
    await _testHelpers.seedBranch("branch-stale", {
      repoPath: "/repo",
      branch: "feat/stale",
      hasCommits: true,
      prState: null,
      lastActivityAt: staleTime,
      paneId: "pane-b",
    });

    paneStore.set(
      new Map([
        [
          "pane-other",
          {
            state: "running",
            transitionedAt: new Date(NOW_MS - 1000).toISOString(),
          },
        ],
      ]),
    );
    await Promise.resolve();

    expect(get(branchLifecycleStore).get("branch-stale")?.lifecycle).toBe(
      "abandoned",
    );
  });

  it("ignores transitions older than the descriptor's current lastActivityAt", async () => {
    initBranchLifecycle();
    const recentTime = NOW_MS - 1 * DAY_MS;
    await _testHelpers.seedBranch("branch-fresh", {
      repoPath: "/repo",
      branch: "feat/fresh",
      hasCommits: true,
      prState: null,
      lastActivityAt: recentTime,
      paneId: "pane-c",
    });
    const before = get(branchLifecycleStore).get("branch-fresh");

    paneStore.set(
      new Map([
        [
          "pane-c",
          {
            state: "running",
            transitionedAt: new Date(NOW_MS - 7 * DAY_MS).toISOString(),
          },
        ],
      ]),
    );
    await Promise.resolve();

    const after = get(branchLifecycleStore).get("branch-fresh");
    expect(after?.lastActivityAt).toBe(before?.lastActivityAt);
  });
});
