/**
 * Tests for the git wrapper module — typed functions over Tauri invoke
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createWorktree,
  removeWorktree,
  listWorktrees,
  listBranches,
  pushBranch,
  deleteBranch,
  gitStatus,
  gitDiff,
  gitLog,
  type WorktreeInfo,
  type BranchInfo,
  type FileStatus,
  type CommitInfo,
} from "../lib/git";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

describe("Worktree operations", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("createWorktree calls invoke with correct args (default base dir)", async () => {
    mockInvoke.mockResolvedValue("/code/project-worktrees/feat-x");

    const result = await createWorktree("/code/project", "jrvs/feat-x", "main");

    expect(mockInvoke).toHaveBeenCalledWith("create_worktree", {
      repoPath: "/code/project",
      branch: "jrvs/feat-x",
      base: "main",
      worktreeBaseDir: null,
    });
    expect(result).toBe("/code/project-worktrees/feat-x");
  });

  it("createWorktree passes worktreeBaseDir when provided", async () => {
    mockInvoke.mockResolvedValue("/custom/worktrees/feat-x");

    const result = await createWorktree(
      "/code/project",
      "jrvs/feat-x",
      "main",
      "nested",
    );

    expect(mockInvoke).toHaveBeenCalledWith("create_worktree", {
      repoPath: "/code/project",
      branch: "jrvs/feat-x",
      base: "main",
      worktreeBaseDir: "nested",
    });
    expect(result).toBe("/custom/worktrees/feat-x");
  });

  it("removeWorktree calls invoke with repo and worktree paths", async () => {
    mockInvoke.mockResolvedValue(undefined);

    await removeWorktree("/code/project", "/code/project-worktrees/feat-x");

    expect(mockInvoke).toHaveBeenCalledWith("remove_worktree", {
      repoPath: "/code/project",
      worktreePath: "/code/project-worktrees/feat-x",
    });
  });

  it("listWorktrees returns typed WorktreeInfo array", async () => {
    const mockData: WorktreeInfo[] = [
      { path: "/code/project", branch: "main", head: "abc123", isBare: false },
      {
        path: "/code/project-worktrees/feat",
        branch: "feat",
        head: "def456",
        isBare: false,
      },
    ];
    mockInvoke.mockResolvedValue(mockData);

    const result = await listWorktrees("/code/project");

    expect(mockInvoke).toHaveBeenCalledWith("list_worktrees", {
      repoPath: "/code/project",
    });
    expect(result).toHaveLength(2);
    expect(result[0].branch).toBe("main");
    expect(result[1].path).toBe("/code/project-worktrees/feat");
  });
});

describe("Branch operations", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("listBranches calls invoke with include_remote", async () => {
    const mockData: BranchInfo[] = [
      { name: "main", isCurrent: true, isRemote: false, head: "abc123" },
      { name: "origin/main", isCurrent: false, isRemote: true, head: "abc123" },
    ];
    mockInvoke.mockResolvedValue(mockData);

    const result = await listBranches("/code/project", true);

    expect(mockInvoke).toHaveBeenCalledWith("list_branches", {
      repoPath: "/code/project",
      includeRemote: true,
    });
    expect(result).toHaveLength(2);
    expect(result[0].isCurrent).toBe(true);
    expect(result[1].isRemote).toBe(true);
  });

  it("listBranches defaults include_remote to false", async () => {
    mockInvoke.mockResolvedValue([]);

    await listBranches("/code/project");

    expect(mockInvoke).toHaveBeenCalledWith("list_branches", {
      repoPath: "/code/project",
      includeRemote: false,
    });
  });

  it("pushBranch calls invoke with correct args", async () => {
    mockInvoke.mockResolvedValue(undefined);

    await pushBranch("/code/project", "jrvs/feat-x");

    expect(mockInvoke).toHaveBeenCalledWith("push_branch", {
      repoPath: "/code/project",
      branch: "jrvs/feat-x",
    });
  });

  it("deleteBranch calls invoke for local delete", async () => {
    mockInvoke.mockResolvedValue(undefined);

    await deleteBranch("/code/project", "old-branch", false);

    expect(mockInvoke).toHaveBeenCalledWith("delete_branch", {
      repoPath: "/code/project",
      branch: "old-branch",
      remote: false,
    });
  });

  it("deleteBranch calls invoke for remote delete", async () => {
    mockInvoke.mockResolvedValue(undefined);

    await deleteBranch("/code/project", "old-branch", true);

    expect(mockInvoke).toHaveBeenCalledWith("delete_branch", {
      repoPath: "/code/project",
      branch: "old-branch",
      remote: true,
    });
  });
});

describe("Diff / status / log", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("gitStatus returns typed FileStatus array", async () => {
    const mockData: FileStatus[] = [
      { path: "src/app.ts", indexStatus: " ", workStatus: "M" },
      { path: "src/new.ts", indexStatus: "A", workStatus: " " },
    ];
    mockInvoke.mockResolvedValue(mockData);

    const result = await gitStatus("/code/worktree");

    expect(mockInvoke).toHaveBeenCalledWith("git_status", {
      worktreePath: "/code/worktree",
    });
    expect(result).toHaveLength(2);
    expect(result[0].workStatus).toBe("M");
    expect(result[1].indexStatus).toBe("A");
  });

  it("gitDiff returns diff string", async () => {
    mockInvoke.mockResolvedValue(
      "diff --git a/file.ts b/file.ts\n+added line\n",
    );

    const result = await gitDiff("/code/worktree");

    expect(mockInvoke).toHaveBeenCalledWith("git_diff", {
      worktreePath: "/code/worktree",
      path: null,
    });
    expect(result).toContain("+added line");
  });

  it("gitDiff with specific file path", async () => {
    mockInvoke.mockResolvedValue("diff for file");

    await gitDiff("/code/worktree", "src/app.ts");

    expect(mockInvoke).toHaveBeenCalledWith("git_diff", {
      worktreePath: "/code/worktree",
      path: "src/app.ts",
    });
  });

  it("gitLog returns typed CommitInfo array", async () => {
    const mockData: CommitInfo[] = [
      {
        hash: "abc123full",
        shortHash: "abc123",
        subject: "feat: add thing",
        author: "Alice",
        date: "2024-01-15 10:30:00 -0500",
      },
    ];
    mockInvoke.mockResolvedValue(mockData);

    const result = await gitLog("/code/worktree");

    expect(mockInvoke).toHaveBeenCalledWith("git_log", {
      worktreePath: "/code/worktree",
      baseBranch: null,
    });
    expect(result).toHaveLength(1);
    expect(result[0].subject).toBe("feat: add thing");
  });

  it("gitLog with base branch for range", async () => {
    mockInvoke.mockResolvedValue([]);

    await gitLog("/code/worktree", "main");

    expect(mockInvoke).toHaveBeenCalledWith("git_log", {
      worktreePath: "/code/worktree",
      baseBranch: "main",
    });
  });
});
