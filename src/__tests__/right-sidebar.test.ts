/**
 * Tests for the Right Sidebar component and its data fetching logic.
 *
 * Tests the RightSidebar helper functions that fetch git data and the
 * UI store integration for visibility toggling.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

// Mock Tauri invoke
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
}));

// Mock git.ts
vi.mock("../lib/git", () => ({
  gitLsFiles: vi.fn(async () => ["src/app.ts", "src/index.ts", "package.json"]),
  gitStatus: vi.fn(async () => [
    { path: "src/app.ts", indexStatus: " ", workStatus: "M" },
    { path: "src/new-file.ts", indexStatus: "?", workStatus: "?" },
    { path: "deleted.ts", indexStatus: " ", workStatus: "D" },
  ]),
  gitLog: vi.fn(async () => [
    {
      hash: "abc123def456",
      shortHash: "abc123d",
      subject: "feat: add new feature",
      author: "Test User",
      date: "2026-04-07",
    },
    {
      hash: "789def012345",
      shortHash: "789def0",
      subject: "fix: resolve bug",
      author: "Test User",
      date: "2026-04-06",
    },
  ]),
  gitDiff: vi.fn(async () => "diff --git a/src/app.ts\n+new line"),
  gitBranchName: vi.fn(async () => "feature/test"),
  gitRevListCount: vi.fn(async () => "3\t1\n"),
  listWorktrees: vi.fn(async () => [
    { path: "/repo", branch: "main", isMain: true },
    { path: "/repo/worktrees/feature", branch: "feature/test", isMain: false },
  ]),
  removeWorktree: vi.fn(async () => {}),
  pushBranch: vi.fn(async () => {}),
  deleteBranch: vi.fn(async () => {}),
}));

import { rightSidebarVisible } from "../lib/stores/ui";
import { gitStatus, gitLog } from "../lib/git";
import type { FileStatus, CommitInfo } from "../lib/git";
import {
  fetchChanges,
  fetchCommits,
  fetchFiles,
  shouldShowRightSidebar,
  fetchAheadBehind,
  groupStagedUnstaged,
} from "../lib/right-sidebar-data";
import { gitBranchName, gitRevListCount } from "../lib/git";

describe("Right Sidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rightSidebarVisible.set(false);
  });

  describe("UI store integration", () => {
    it("rightSidebarVisible defaults to false", () => {
      expect(get(rightSidebarVisible)).toBe(false);
    });

    it("toggles right sidebar visibility", () => {
      rightSidebarVisible.set(true);
      expect(get(rightSidebarVisible)).toBe(true);
      rightSidebarVisible.set(false);
      expect(get(rightSidebarVisible)).toBe(false);
    });
  });

  describe("shouldShowRightSidebar", () => {
    it("returns true for managed workspaces with projectId", () => {
      expect(
        shouldShowRightSidebar({
          id: "ws-1",
          type: "managed",
          name: "Feature",
          status: "active",
          projectId: "proj-1",
        }),
      ).toBe(true);
    });

    it("returns false for floating terminal workspaces (no projectId)", () => {
      expect(
        shouldShowRightSidebar({
          id: "ws-1",
          type: "terminal",
          name: "Terminal",
          status: "active",
        }),
      ).toBe(false);
    });

    it("returns true for project-scoped workspaces", () => {
      expect(
        shouldShowRightSidebar({
          id: "ws-1",
          type: "terminal",
          name: "Terminal",
          status: "active",
          projectId: "proj-1",
        }),
      ).toBe(true);
    });

    it("returns false when meta is undefined", () => {
      expect(shouldShowRightSidebar(undefined)).toBe(false);
    });
  });

  describe("fetchChanges", () => {
    it("calls gitStatus with the worktree path", async () => {
      await fetchChanges("/my/worktree");

      expect(gitStatus).toHaveBeenCalledWith("/my/worktree");
    });

    it("returns file status entries", async () => {
      const result = await fetchChanges("/my/worktree");

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        path: "src/app.ts",
        indexStatus: " ",
        workStatus: "M",
      });
      expect(result[1]).toEqual({
        path: "src/new-file.ts",
        indexStatus: "?",
        workStatus: "?",
      });
      expect(result[2]).toEqual({
        path: "deleted.ts",
        indexStatus: " ",
        workStatus: "D",
      });
    });

    it("returns empty array on error", async () => {
      vi.mocked(gitStatus).mockRejectedValueOnce(new Error("git failed"));

      const result = await fetchChanges("/bad/path");

      expect(result).toEqual([]);
    });
  });

  describe("fetchFiles", () => {
    it("calls list_files_recursive via invoke", async () => {
      mockInvoke.mockResolvedValueOnce(["src/app.ts", "package.json"]);
      await fetchFiles("/my/dir");
      expect(mockInvoke).toHaveBeenCalledWith("list_files_recursive", {
        path: "/my/dir",
      });
    });

    it("returns file paths from invoke", async () => {
      mockInvoke.mockResolvedValueOnce([
        "src/app.ts",
        "src/index.ts",
        "package.json",
      ]);
      const result = await fetchFiles("/my/dir");
      expect(result).toHaveLength(3);
      expect(result[0]).toBe("src/app.ts");
    });

    it("returns empty array on error", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("failed"));
      const result = await fetchFiles("/bad/path");
      expect(result).toEqual([]);
    });
  });

  describe("fetchCommits", () => {
    it("calls gitLog with worktree path and base branch", async () => {
      await fetchCommits("/my/worktree", "main");

      expect(gitLog).toHaveBeenCalledWith("/my/worktree", "main");
    });

    it("returns commit entries", async () => {
      const result = await fetchCommits("/my/worktree", "main");

      expect(result).toHaveLength(2);
      expect(result[0].subject).toBe("feat: add new feature");
      expect(result[1].shortHash).toBe("789def0");
    });

    it("returns empty array on error", async () => {
      vi.mocked(gitLog).mockRejectedValueOnce(new Error("git failed"));

      const result = await fetchCommits("/bad/path");

      expect(result).toEqual([]);
    });

    it("works without baseBranch", async () => {
      await fetchCommits("/my/worktree");

      expect(gitLog).toHaveBeenCalledWith("/my/worktree", undefined);
    });
  });

  describe("fetchAheadBehind", () => {
    it("returns ahead and behind counts from git rev-list", async () => {
      const result = await fetchAheadBehind("/my/worktree");

      expect(gitBranchName).toHaveBeenCalledWith("/my/worktree");
      expect(gitRevListCount).toHaveBeenCalledWith(
        "/my/worktree",
        "feature/test",
        "origin/feature/test",
      );
      expect(result).toEqual({ ahead: 3, behind: 1 });
    });

    it("returns zeros when gitBranchName fails", async () => {
      vi.mocked(gitBranchName).mockRejectedValueOnce(
        new Error("detached HEAD"),
      );

      const result = await fetchAheadBehind("/my/worktree");

      expect(result).toEqual({ ahead: 0, behind: 0 });
    });

    it("returns zeros when gitRevListCount fails", async () => {
      vi.mocked(gitRevListCount).mockRejectedValueOnce(
        new Error("no upstream"),
      );

      const result = await fetchAheadBehind("/my/worktree");

      expect(result).toEqual({ ahead: 0, behind: 0 });
    });

    it("handles zero counts", async () => {
      vi.mocked(gitRevListCount).mockResolvedValueOnce("0\t0\n");

      const result = await fetchAheadBehind("/my/worktree");

      expect(result).toEqual({ ahead: 0, behind: 0 });
    });
  });

  describe("groupStagedUnstaged", () => {
    it("groups files into staged and unstaged sections", () => {
      const changes = [
        { path: "src/staged.ts", indexStatus: "M", workStatus: " " },
        { path: "src/unstaged.ts", indexStatus: " ", workStatus: "M" },
        { path: "src/both.ts", indexStatus: "A", workStatus: "M" },
        { path: "src/untracked.ts", indexStatus: "?", workStatus: "?" },
      ];

      const result = groupStagedUnstaged(changes);

      expect(result.staged).toHaveLength(2);
      expect(result.staged.map((f) => f.path)).toEqual([
        "src/staged.ts",
        "src/both.ts",
      ]);
      expect(result.unstaged).toHaveLength(3);
      expect(result.unstaged.map((f) => f.path)).toEqual([
        "src/unstaged.ts",
        "src/both.ts",
        "src/untracked.ts",
      ]);
    });

    it("returns empty arrays when no changes", () => {
      const result = groupStagedUnstaged([]);

      expect(result.staged).toEqual([]);
      expect(result.unstaged).toEqual([]);
    });

    it("handles all-staged scenario", () => {
      const changes = [
        { path: "a.ts", indexStatus: "A", workStatus: " " },
        { path: "b.ts", indexStatus: "M", workStatus: " " },
      ];

      const result = groupStagedUnstaged(changes);

      expect(result.staged).toHaveLength(2);
      expect(result.unstaged).toHaveLength(0);
    });

    it("handles all-unstaged scenario", () => {
      const changes = [
        { path: "a.ts", indexStatus: " ", workStatus: "M" },
        { path: "b.ts", indexStatus: " ", workStatus: "D" },
      ];

      const result = groupStagedUnstaged(changes);

      expect(result.staged).toHaveLength(0);
      expect(result.unstaged).toHaveLength(2);
    });
  });
});
