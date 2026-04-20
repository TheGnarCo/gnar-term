/**
 * Tests for the core mergeAndArchiveWorktreeWorkspace flow. Validates
 * merge success/failure flows, dirty worktree handling, event emission,
 * and workspace ID tracking.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

// Mock Tauri invoke — controls git_status, git_checkout, git_merge, etc.
const mockInvoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn().mockResolvedValue(""),
  writeText: vi.fn().mockResolvedValue(undefined),
}));

const mockShowInputPrompt =
  vi.fn<(label: string, defaultValue?: string) => Promise<string | null>>();
const mockShowFormPrompt = vi.fn<
  (
    title: string,
    fields: Array<{
      key: string;
      label: string;
      defaultValue?: string;
      placeholder?: string;
    }>,
  ) => Promise<Record<string, string> | null>
>();
vi.mock("../lib/stores/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/stores/ui")>();
  return {
    ...actual,
    showInputPrompt: (...args: [string, string?]) =>
      mockShowInputPrompt(...args),
    showFormPrompt: (
      ...args: [
        string,
        Array<{
          key: string;
          label: string;
          defaultValue?: string;
          placeholder?: string;
        }>,
      ]
    ) => mockShowFormPrompt(...args),
  };
});

// Stub config so saveConfig calls during the flow are no-ops
vi.mock("../lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/config")>();
  return {
    ...actual,
    getConfig: () => ({ worktrees: { entries: [] } }),
    saveConfig: vi.fn().mockResolvedValue(undefined),
  };
});

import {
  archiveWorktreeWorkspace,
  handleWorkspaceCreated,
  mergeAndArchiveWorktreeWorkspace,
  _resetWorktreeService,
  _seedWorktreeEntries,
  worktreeEntriesStore,
  getWorktreeEntries,
} from "../lib/services/worktree-service";
import { eventBus } from "../lib/services/event-bus";
import type { WorktreeWorkspaceEntry } from "../lib/config";

function makeEntry(
  overrides: Partial<WorktreeWorkspaceEntry> = {},
): WorktreeWorkspaceEntry {
  return {
    worktreePath: overrides.worktreePath ?? "/repos/myrepo-feat-x",
    branch: overrides.branch ?? "feat-x",
    baseBranch: overrides.baseBranch ?? "main",
    repoPath: overrides.repoPath ?? "/repos/myrepo",
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
    ...(overrides.workspaceId ? { workspaceId: overrides.workspaceId } : {}),
  };
}

describe("Merge & Archive Worktree (core service)", () => {
  beforeEach(() => {
    _resetWorktreeService();
    mockInvoke.mockReset().mockResolvedValue(undefined);
    mockShowInputPrompt.mockReset();
    mockShowFormPrompt.mockReset();
  });

  it("merges, archives, emits worktree:merged event, and removes entry on success", async () => {
    const entry = makeEntry({ workspaceId: "ws-42" });
    _seedWorktreeEntries([entry]);

    mockShowInputPrompt
      .mockResolvedValueOnce(entry.branch)
      .mockResolvedValueOnce("yes");

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "git_status") return Promise.resolve([]);
      if (cmd === "git_checkout") return Promise.resolve(undefined);
      if (cmd === "git_merge")
        return Promise.resolve({ success: true, message: "Merged" });
      if (cmd === "push_branch") return Promise.resolve(undefined);
      if (cmd === "remove_worktree") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    const emitted: Record<string, unknown>[] = [];
    const handler = (ev: Record<string, unknown>) => emitted.push(ev);
    eventBus.on("worktree:merged", handler);

    await mergeAndArchiveWorktreeWorkspace();

    expect(mockInvoke).toHaveBeenCalledWith("git_status", {
      repoPath: entry.worktreePath,
    });
    expect(mockInvoke).toHaveBeenCalledWith("git_checkout", {
      repoPath: entry.repoPath,
      branch: entry.baseBranch,
    });
    expect(mockInvoke).toHaveBeenCalledWith("git_merge", {
      repoPath: entry.repoPath,
      branch: entry.branch,
    });
    expect(mockInvoke).toHaveBeenCalledWith("push_branch", {
      repoPath: entry.repoPath,
      branch: entry.baseBranch,
    });
    expect(mockInvoke).toHaveBeenCalledWith("remove_worktree", {
      repoPath: entry.repoPath,
      worktreePath: entry.worktreePath,
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      type: "worktree:merged",
      worktreePath: entry.worktreePath,
      branch: entry.branch,
      baseBranch: entry.baseBranch,
      repoPath: entry.repoPath,
      workspaceId: "ws-42",
    });

    expect(get(worktreeEntriesStore)).toEqual([]);

    eventBus.off("worktree:merged", handler);
  });

  it("aborts merge on conflict, preserves state, shows conflict list", async () => {
    const entry = makeEntry();
    _seedWorktreeEntries([entry]);

    mockShowInputPrompt.mockResolvedValueOnce(entry.branch);

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "git_status") return Promise.resolve([]);
      if (cmd === "git_checkout") return Promise.resolve(undefined);
      if (cmd === "git_merge")
        return Promise.resolve({
          success: false,
          message: "Conflict",
          conflicts: ["src/app.ts", "package.json"],
        });
      return Promise.resolve(undefined);
    });

    mockShowFormPrompt.mockResolvedValueOnce(null);

    const emitted: unknown[] = [];
    const handler = (ev: unknown) => emitted.push(ev);
    eventBus.on("worktree:merged", handler);

    await mergeAndArchiveWorktreeWorkspace();

    expect(mockShowFormPrompt).toHaveBeenCalledWith(
      "Merge failed — conflicts detected",
      expect.arrayContaining([
        expect.objectContaining({
          key: "conflicts",
          defaultValue: "src/app.ts\npackage.json",
        }),
      ]),
    );

    expect(mockInvoke).not.toHaveBeenCalledWith(
      "remove_worktree",
      expect.anything(),
    );
    expect(emitted).toHaveLength(0);
    expect(get(worktreeEntriesStore)).toHaveLength(1);

    eventBus.off("worktree:merged", handler);
  });

  it("aborts if worktree has uncommitted changes", async () => {
    const entry = makeEntry();
    _seedWorktreeEntries([entry]);

    mockShowInputPrompt.mockResolvedValueOnce(entry.branch);

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "git_status")
        return Promise.resolve([{ path: "src/dirty.ts", status: "modified" }]);
      return Promise.resolve(undefined);
    });

    mockShowFormPrompt.mockResolvedValueOnce(null);

    await mergeAndArchiveWorktreeWorkspace();

    expect(mockShowFormPrompt).toHaveBeenCalledWith(
      "Cannot merge",
      expect.arrayContaining([
        expect.objectContaining({
          label: "Worktree has uncommitted changes",
        }),
      ]),
    );

    expect(mockInvoke).not.toHaveBeenCalledWith("git_merge", expect.anything());
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "git_checkout",
      expect.anything(),
    );
    expect(get(worktreeEntriesStore)).toHaveLength(1);
  });

  it("returns early when no managed workspaces exist", async () => {
    _seedWorktreeEntries([]);

    await mergeAndArchiveWorktreeWorkspace();

    expect(mockShowInputPrompt).not.toHaveBeenCalled();
    expect(mockShowFormPrompt).not.toHaveBeenCalled();
  });

  it("returns early when user cancels branch selection", async () => {
    _seedWorktreeEntries([makeEntry()]);

    mockShowInputPrompt.mockResolvedValueOnce(null);

    await mergeAndArchiveWorktreeWorkspace();

    expect(mockInvoke).not.toHaveBeenCalledWith(
      "git_status",
      expect.anything(),
    );
  });

  it("returns early when selected branch does not match any entry", async () => {
    _seedWorktreeEntries([makeEntry()]);

    mockShowInputPrompt.mockResolvedValueOnce("nonexistent-branch");

    await mergeAndArchiveWorktreeWorkspace();

    expect(mockInvoke).not.toHaveBeenCalledWith(
      "git_status",
      expect.anything(),
    );
  });

  it("shows error and aborts when base branch checkout fails", async () => {
    const entry = makeEntry();
    _seedWorktreeEntries([entry]);

    mockShowInputPrompt.mockResolvedValueOnce(entry.branch);

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "git_status") return Promise.resolve([]);
      if (cmd === "git_checkout")
        return Promise.reject(new Error("checkout failed"));
      return Promise.resolve(undefined);
    });

    mockShowFormPrompt.mockResolvedValueOnce(null);

    await mergeAndArchiveWorktreeWorkspace();

    expect(mockShowFormPrompt).toHaveBeenCalledWith(
      "Failed to checkout base branch",
      expect.arrayContaining([
        expect.objectContaining({
          key: "error",
        }),
      ]),
    );

    expect(mockInvoke).not.toHaveBeenCalledWith("git_merge", expect.anything());
  });

  it("workspace:created handler captures workspaceId into entry", () => {
    const entry = makeEntry();
    _seedWorktreeEntries([entry]);

    handleWorkspaceCreated("ws-99", { worktreePath: entry.worktreePath });

    const entries = getWorktreeEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].workspaceId).toBe("ws-99");
  });

  it("workspace:created handler does not modify entries without matching worktreePath", () => {
    _seedWorktreeEntries([makeEntry()]);

    handleWorkspaceCreated("ws-100", { worktreePath: "/some/other/path" });

    const entries = getWorktreeEntries();
    expect(entries[0].workspaceId).toBeUndefined();
  });

  it("emits empty string for workspaceId when not tracked", async () => {
    const entry = makeEntry();
    _seedWorktreeEntries([entry]);

    mockShowInputPrompt
      .mockResolvedValueOnce(entry.branch)
      .mockResolvedValueOnce("no");

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "git_status") return Promise.resolve([]);
      if (cmd === "git_checkout") return Promise.resolve(undefined);
      if (cmd === "git_merge")
        return Promise.resolve({ success: true, message: "Merged" });
      if (cmd === "remove_worktree") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    const emitted: Record<string, unknown>[] = [];
    const handler = (ev: Record<string, unknown>) => emitted.push(ev);
    eventBus.on("worktree:merged", handler);

    await mergeAndArchiveWorktreeWorkspace();

    expect(emitted[0]).toMatchObject({ workspaceId: "" });

    eventBus.off("worktree:merged", handler);
  });

  it("skips push when user declines", async () => {
    const entry = makeEntry();
    _seedWorktreeEntries([entry]);

    mockShowInputPrompt
      .mockResolvedValueOnce(entry.branch)
      .mockResolvedValueOnce("no");

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "git_status") return Promise.resolve([]);
      if (cmd === "git_checkout") return Promise.resolve(undefined);
      if (cmd === "git_merge")
        return Promise.resolve({ success: true, message: "Merged" });
      if (cmd === "remove_worktree") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    await mergeAndArchiveWorktreeWorkspace();

    expect(mockInvoke).not.toHaveBeenCalledWith(
      "push_branch",
      expect.anything(),
    );
    expect(mockInvoke).toHaveBeenCalledWith("remove_worktree", {
      repoPath: entry.repoPath,
      worktreePath: entry.worktreePath,
    });
  });
});

describe("Archive Worktree (core service)", () => {
  beforeEach(() => {
    _resetWorktreeService();
    mockInvoke.mockReset().mockResolvedValue(undefined);
    mockShowInputPrompt.mockReset();
    mockShowFormPrompt.mockReset();
  });

  it("pushes (when user opts in) and removes the worktree", async () => {
    const entry = makeEntry();
    _seedWorktreeEntries([entry]);

    mockShowInputPrompt
      .mockResolvedValueOnce(entry.branch)
      .mockResolvedValueOnce("yes");

    await archiveWorktreeWorkspace();

    expect(mockInvoke).toHaveBeenCalledWith("push_branch", {
      repoPath: entry.repoPath,
      branch: entry.branch,
    });
    expect(mockInvoke).toHaveBeenCalledWith("remove_worktree", {
      repoPath: entry.repoPath,
      worktreePath: entry.worktreePath,
    });
    expect(get(worktreeEntriesStore)).toEqual([]);
  });
});
