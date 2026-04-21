/**
 * Tests for the core git status service: parsing, init bootstrap, and
 * regression coverage for the cwd-race / cwd-refresh / stale-clear bugs
 * inherited from the previous extension implementation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import {
  parseGitStatus,
  parsePrInfo,
  formatDirtyShorthand,
  GIT_STATUS_SOURCE,
  _resetGitStatusService,
} from "../lib/services/git-status-service";
import { initGitStatus } from "../lib/bootstrap/init-git-status";
import {
  workspaceSubtitleStore,
  resetWorkspaceSubtitles,
} from "../lib/services/workspace-subtitle-registry";
import { statusRegistry } from "../lib/services/status-registry";
import { eventBus } from "../lib/services/event-bus";
import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import type { Workspace } from "../lib/types";

function makeWs(id: string, surfaceId: string, cwd: string): Workspace {
  return {
    id,
    name: id,
    activePaneId: `pane-${id}`,
    splitRoot: {
      type: "pane",
      pane: {
        id: `pane-${id}`,
        activeSurfaceId: surfaceId,
        surfaces: [
          {
            id: surfaceId,
            kind: "terminal",
            title: "zsh",
            ptyId: id === "A" ? 1 : 2,
            cwd,
            terminal: { dispose: vi.fn(), focus: vi.fn() },
          },
        ],
      },
    },
  } as unknown as Workspace;
}

async function drain(n = 50): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

describe("ScriptOutput exit code contract", () => {
  it("exit_code field is used to determine command success", () => {
    const successResult = { stdout: "main\n", stderr: "", exit_code: 0 };
    const isFailure = !successResult || successResult.exit_code !== 0;
    expect(isFailure).toBe(false);
  });

  it("exit_code field detects non-zero exit", () => {
    const failResult = { stdout: "", stderr: "error", exit_code: 128 };
    const isFailure = !failResult || failResult.exit_code !== 0;
    expect(isFailure).toBe(true);
  });
});

describe("parseGitStatus", () => {
  it("parses branch with no changes", () => {
    const result = parseGitStatus("## main...origin/main");
    expect(result).toMatchObject({
      branch: "main",
      isDetached: false,
      modified: 0,
      untracked: 0,
      staged: 0,
    });
  });

  it("parses branch with ahead/behind", () => {
    const result = parseGitStatus(
      "## feat/bar...origin/feat/bar [ahead 2, behind 1]",
    );
    expect(result).toMatchObject({
      branch: "feat/bar",
      ahead: 2,
      behind: 1,
    });
  });

  it("counts modified, untracked, and staged files", () => {
    const raw = [
      "## main...origin/main",
      " M src/foo.ts",
      " M src/bar.ts",
      "A  src/new.ts",
      "?? untracked.txt",
      "?? another.txt",
    ].join("\n");

    const result = parseGitStatus(raw);
    expect(result).toMatchObject({
      modified: 2,
      untracked: 2,
      staged: 1,
    });
  });

  it("splits out added / deleted / renamed into their own per-op buckets", () => {
    const raw = [
      "## main...origin/main",
      " M src/edit.ts",
      "A  src/added.ts",
      " D src/removed.ts",
      "R  old.ts -> new.ts",
      "?? u.ts",
    ].join("\n");

    const result = parseGitStatus(raw);
    expect(result).toMatchObject({
      modified: 2, // " M" (work-tree) + " D" (work-tree)
      staged: 2, // "A " + "R "
      added: 1,
      deleted: 1,
      renamed: 1,
      untracked: 1,
    });
  });
});

describe("formatDirtyShorthand", () => {
  it("renders non-zero buckets with git single-letter prefixes", () => {
    const info = {
      branch: "main",
      isDetached: false,
      modified: 5,
      staged: 0,
      added: 2,
      deleted: 1,
      renamed: 0,
      untracked: 3,
      ahead: 0,
      behind: 0,
    };
    // M5 (5 modified - 2 added - 1 deleted - 0 renamed = 2 pure-M;
    // parseGitStatus counts added/deleted IN the modified total for
    // files with a worktree-status column, so the formatter subtracts
    // them back out to avoid double-counting).
    expect(formatDirtyShorthand(info)).toBe("M2 A2 D1 ?3");
  });

  it("returns empty string when the tree is clean", () => {
    expect(
      formatDirtyShorthand({
        branch: "main",
        isDetached: false,
        modified: 0,
        staged: 0,
        added: 0,
        deleted: 0,
        renamed: 0,
        untracked: 0,
        ahead: 0,
        behind: 0,
      }),
    ).toBe("");
  });

  it("skips zero buckets so a single-file change stays compact", () => {
    expect(
      formatDirtyShorthand({
        branch: "main",
        isDetached: false,
        modified: 1,
        staged: 0,
        added: 0,
        deleted: 0,
        renamed: 0,
        untracked: 0,
        ahead: 0,
        behind: 0,
      }),
    ).toBe("M1");
  });

  it("handles branch-only header (no tracking)", () => {
    const result = parseGitStatus("## feat/no-remote");
    expect(result).toMatchObject({
      branch: "feat/no-remote",
      ahead: 0,
      behind: 0,
    });
  });

  it("returns null for empty input", () => {
    expect(parseGitStatus("")).toBeNull();
  });
});

describe("parsePrInfo", () => {
  it("parses approved PR with passing CI", () => {
    const raw = JSON.stringify({
      number: 42,
      url: "https://github.com/org/repo/pull/42",
      reviewDecision: "APPROVED",
      statusCheckRollup: [
        { state: "SUCCESS", conclusion: "SUCCESS" },
        { state: "SUCCESS", conclusion: "SUCCESS" },
      ],
    });

    const result = parsePrInfo(raw);
    expect(result).toMatchObject({
      number: 42,
      reviewDecision: "approved",
      ciStatus: "passing",
    });
  });

  it("detects failing CI", () => {
    const raw = JSON.stringify({
      number: 38,
      url: "https://github.com/org/repo/pull/38",
      reviewDecision: "CHANGES_REQUESTED",
      statusCheckRollup: [
        { state: "SUCCESS", conclusion: "SUCCESS" },
        { state: "FAILURE", conclusion: "FAILURE" },
      ],
    });

    const result = parsePrInfo(raw);
    expect(result).toMatchObject({
      ciStatus: "failing",
      reviewDecision: "changes requested",
    });
  });

  it("detects pending CI", () => {
    const raw = JSON.stringify({
      number: 51,
      url: "https://github.com/org/repo/pull/51",
      reviewDecision: "APPROVED",
      statusCheckRollup: [
        { state: "SUCCESS", conclusion: "SUCCESS" },
        { state: "PENDING" },
      ],
    });

    const result = parsePrInfo(raw);
    expect(result).toMatchObject({
      ciStatus: "pending",
      reviewDecision: "approved",
    });
  });

  it("handles no status checks", () => {
    const raw = JSON.stringify({
      number: 80,
      url: "https://github.com/org/repo/pull/80",
      reviewDecision: "REVIEW_REQUIRED",
      statusCheckRollup: [],
    });

    const result = parsePrInfo(raw);
    expect(result).toMatchObject({
      ciStatus: "none",
      reviewDecision: "review requested",
    });
  });

  it("returns null for invalid JSON", () => {
    expect(parsePrInfo("not json")).toBeNull();
  });

  it("returns null for missing PR number", () => {
    expect(parsePrInfo(JSON.stringify({ url: "test" }))).toBeNull();
  });
});

describe("initGitStatus()", () => {
  beforeEach(() => {
    _resetGitStatusService();
    resetWorkspaceSubtitles();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    statusRegistry.reset();
  });

  afterEach(() => {
    _resetGitStatusService();
    resetWorkspaceSubtitles();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    statusRegistry.reset();
  });

  it("registers the workspace subtitle component", () => {
    initGitStatus();
    const subtitle = get(workspaceSubtitleStore).find(
      (s) => s.source === GIT_STATUS_SOURCE,
    );
    expect(subtitle).toBeTruthy();
    expect(subtitle!.priority).toBe(10);
  });

  it("clears workspace status on workspace:closed", async () => {
    initGitStatus();
    workspaces.set([makeWs("A", "surf-A", "/repos/project-A")]);
    activeWorkspaceIdx.set(0);

    const tauri = await import("@tauri-apps/api/core");
    const invokeMock = vi.mocked(tauri.invoke);
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "get_pty_cwd") return "/repos/project-A";
      if (cmd === "run_script") {
        const a = args as { command?: string };
        if (a?.command?.includes("echo $HOME"))
          return { stdout: "/Users/x\n", stderr: "", exit_code: 0 };
        if (a?.command?.includes("rev-parse --show-toplevel"))
          return { stdout: "/repos/project-A\n", stderr: "", exit_code: 0 };
        if (a?.command?.includes("status --porcelain=v1 -b"))
          return {
            stdout: "## branch-A...origin/main\n M file.ts\n",
            stderr: "",
            exit_code: 0,
          };
        if (a?.command?.includes("rev-parse --abbrev-ref HEAD"))
          return { stdout: "branch-A\n", stderr: "", exit_code: 0 };
        return { stdout: "", stderr: "", exit_code: 1 };
      }
      return undefined;
    });

    eventBus.emit({ type: "workspace:activated", id: "A", previousId: null });
    await drain();

    const before = get(statusRegistry.store).filter(
      (i) => i.source === GIT_STATUS_SOURCE && i.workspaceId === "A",
    );
    expect(before.length).toBeGreaterThan(0);

    eventBus.emit({ type: "workspace:closed", id: "A" });
    const after = get(statusRegistry.store).filter(
      (i) => i.source === GIT_STATUS_SOURCE && i.workspaceId === "A",
    );
    expect(after).toHaveLength(0);
  });
});

describe("git status service: ensurePolling CWD-race resilience", () => {
  beforeEach(() => {
    _resetGitStatusService();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    statusRegistry.reset();
  });

  afterEach(() => {
    _resetGitStatusService();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    statusRegistry.reset();
  });

  it("does not cross-assign workspace A's cwd to workspace B on rapid activation switch", async () => {
    workspaces.set([
      makeWs("A", "surf-A", "/repos/project-A"),
      makeWs("B", "surf-B", "/repos/project-B"),
    ]);
    activeWorkspaceIdx.set(0);

    const tauri = await import("@tauri-apps/api/core");
    const invokeMock = vi.mocked(tauri.invoke);
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "get_home") return "/Users/x";
      if (cmd === "get_pty_cwd") {
        const a = args as { ptyId?: number };
        return a.ptyId === 1 ? "/repos/project-A" : "/repos/project-B";
      }
      if (cmd === "run_script") {
        const a = args as { cwd?: string; command?: string };
        if (a.command?.includes("echo $HOME"))
          return { stdout: "/Users/x\n", stderr: "", exit_code: 0 };
        if (a.command?.includes("rev-parse --show-toplevel"))
          return { stdout: `${a.cwd}\n`, stderr: "", exit_code: 0 };
        if (a.command?.includes("status --porcelain=v1 -b")) {
          const branch = a.cwd?.includes("project-A") ? "branch-A" : "branch-B";
          return {
            stdout: `## ${branch}...origin/main\n`,
            stderr: "",
            exit_code: 0,
          };
        }
        if (a.command?.includes("rev-parse --abbrev-ref HEAD")) {
          const branch = a.cwd?.includes("project-A") ? "branch-A" : "branch-B";
          return { stdout: `${branch}\n`, stderr: "", exit_code: 0 };
        }
        return { stdout: "", stderr: "", exit_code: 1 };
      }
      return undefined;
    });

    initGitStatus();

    eventBus.emit({ type: "workspace:activated", id: "A", previousId: null });
    activeWorkspaceIdx.set(1);
    eventBus.emit({ type: "workspace:activated", id: "B", previousId: "A" });

    await drain();

    const items = get(statusRegistry.store);
    const branchA = items.find(
      (i) =>
        i.source === GIT_STATUS_SOURCE &&
        i.workspaceId === "A" &&
        i.id.endsWith(":branch"),
    );
    const branchB = items.find(
      (i) =>
        i.source === GIT_STATUS_SOURCE &&
        i.workspaceId === "B" &&
        i.id.endsWith(":branch"),
    );

    if (branchA) expect(branchA.label).toBe("branch-A");
    if (branchB) expect(branchB.label).toBe("branch-B");

    expect(branchB).toBeDefined();
    expect(branchB!.label).toBe("branch-B");
  });
});

describe("git status service: refreshes when the active workspace's cwd changes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetGitStatusService();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    statusRegistry.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    _resetGitStatusService();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    statusRegistry.reset();
  });

  it("re-runs git status with the NEW cwd after the store fires an update", async () => {
    const ws = makeWs("A", "surf-A", "/repos/project-A");
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

    let ptyCwd = "/repos/project-A";
    const runScriptCalls: Array<{ cwd?: string; command?: string }> = [];
    const tauri = await import("@tauri-apps/api/core");
    const invokeMock = vi.mocked(tauri.invoke);
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "get_home") return "/Users/x";
      if (cmd === "get_pty_cwd") return ptyCwd;
      if (cmd === "run_script") {
        const a = args as { cwd?: string; command?: string };
        runScriptCalls.push({ cwd: a.cwd, command: a.command });
        if (a.command?.includes("echo $HOME"))
          return { stdout: "/Users/x\n", stderr: "", exit_code: 0 };
        if (a.command?.includes("rev-parse --show-toplevel"))
          return { stdout: `${a.cwd}\n`, stderr: "", exit_code: 0 };
        if (a.command?.includes("status --porcelain=v1 -b")) {
          const branch = a.cwd?.includes("project-A")
            ? "branch-A"
            : a.cwd?.includes("project-B")
              ? "branch-B"
              : "branch-unknown";
          return {
            stdout: `## ${branch}...origin/main\n`,
            stderr: "",
            exit_code: 0,
          };
        }
        if (a.command?.includes("rev-parse --abbrev-ref HEAD")) {
          const branch = a.cwd?.includes("project-A") ? "branch-A" : "branch-B";
          return { stdout: `${branch}\n`, stderr: "", exit_code: 0 };
        }
        return { stdout: "", stderr: "", exit_code: 1 };
      }
      return undefined;
    });

    initGitStatus();

    eventBus.emit({ type: "workspace:activated", id: "A", previousId: null });
    await drain(100);

    const initialStatus = runScriptCalls.find((c) =>
      c.command?.includes("status --porcelain=v1 -b"),
    );
    expect(initialStatus?.cwd).toContain("project-A");
    const initialItems = get(statusRegistry.store);
    expect(
      initialItems.find(
        (i) => i.workspaceId === "A" && i.id.endsWith(":branch"),
      )?.label,
    ).toBe("branch-A");

    ptyCwd = "/repos/project-B";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ws.splitRoot as any).pane.surfaces[0].cwd = "/repos/project-B";
    workspaces.update((l) => [...l]);

    await vi.advanceTimersByTimeAsync(600);
    await drain(100);

    const statusRunsAgainstB = runScriptCalls.filter(
      (c) =>
        c.command?.includes("status --porcelain=v1 -b") &&
        c.cwd?.includes("project-B"),
    );
    expect(statusRunsAgainstB.length).toBeGreaterThan(0);

    const finalItems = get(statusRegistry.store);
    const branchItem = finalItems.find(
      (i) => i.workspaceId === "A" && i.id.endsWith(":branch"),
    );
    expect(branchItem?.label).toBe("branch-B");
  });
});

describe("git status service: stale-data clear (H4)", () => {
  beforeEach(() => {
    _resetGitStatusService();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    statusRegistry.reset();
  });

  afterEach(() => {
    _resetGitStatusService();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    statusRegistry.reset();
  });

  it("clears branch+dirty items when git status fails after a successful fetch", async () => {
    vi.useFakeTimers();
    try {
      workspaces.set([
        {
          id: "ws-fail",
          name: "Fail",
          activePaneId: "p1",
          splitRoot: {
            type: "pane",
            pane: {
              id: "p1",
              activeSurfaceId: "s1",
              surfaces: [
                {
                  id: "s1",
                  kind: "terminal",
                  title: "zsh",
                  ptyId: 1,
                  cwd: "/tmp/repo",
                  terminal: { dispose: vi.fn(), focus: vi.fn() },
                },
              ],
            },
          },
        },
      ] as unknown as Workspace[]);
      activeWorkspaceIdx.set(0);

      const okResponses: Record<
        string,
        { stdout: string; stderr: string; exit_code: number } | null
      > = {
        "echo $HOME": { stdout: "/Users/x\n", stderr: "", exit_code: 0 },
        "rev-parse --show-toplevel": {
          stdout: "/tmp/repo\n",
          stderr: "",
          exit_code: 0,
        },
        "status --porcelain=v1 -b": {
          stdout: "## main...origin/main\n M file.ts\n",
          stderr: "",
          exit_code: 0,
        },
        "rev-parse --abbrev-ref HEAD": {
          stdout: "main\n",
          stderr: "",
          exit_code: 0,
        },
        "gh pr view": { stdout: "{}", stderr: "", exit_code: 1 },
      };

      const tauri = await import("@tauri-apps/api/core");
      const invokeMock = vi.mocked(tauri.invoke);
      invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
        if (cmd === "get_home") return "/Users/x";
        if (cmd === "run_script") {
          const a = args as { command?: string };
          const key = Object.keys(okResponses).find((k) =>
            a?.command?.includes(k),
          );
          if (!key) return null;
          const val = okResponses[key];
          if (val === null) throw new Error("failure");
          return val;
        }
        return undefined;
      });

      initGitStatus();

      eventBus.emit({
        type: "workspace:activated",
        id: "ws-fail",
        previousId: null,
      });

      await drain(20);

      const itemsAfterSuccess = get(statusRegistry.store);
      expect(
        itemsAfterSuccess.some(
          (i) =>
            i.source === GIT_STATUS_SOURCE &&
            i.workspaceId === "ws-fail" &&
            i.id.endsWith(":branch"),
        ),
      ).toBe(true);
      expect(
        itemsAfterSuccess.some(
          (i) =>
            i.source === GIT_STATUS_SOURCE &&
            i.workspaceId === "ws-fail" &&
            i.id.endsWith(":dirty"),
        ),
      ).toBe(true);

      invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
        if (cmd === "get_home") return "/Users/x";
        if (cmd === "run_script") {
          const a = args as { command?: string };
          if (a?.command?.includes("rev-parse --show-toplevel")) {
            return {
              stdout: "/tmp/repo\n",
              stderr: "",
              exit_code: 0,
            };
          }
          return null;
        }
        return undefined;
      });

      await vi.advanceTimersByTimeAsync(30_100);
      await drain(20);

      const itemsAfterFail = get(statusRegistry.store);
      expect(
        itemsAfterFail.some(
          (i) =>
            i.source === GIT_STATUS_SOURCE &&
            i.workspaceId === "ws-fail" &&
            i.id.endsWith(":branch"),
        ),
      ).toBe(false);
      expect(
        itemsAfterFail.some(
          (i) =>
            i.source === GIT_STATUS_SOURCE &&
            i.workspaceId === "ws-fail" &&
            i.id.endsWith(":dirty"),
        ),
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
