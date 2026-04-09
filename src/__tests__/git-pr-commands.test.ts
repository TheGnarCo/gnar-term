/**
 * Tests for the PR workflow git wrappers — gitAdd, gitCommit, gitPush,
 * gitBranchName, gitDiffStaged, ghCreatePr
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  gitAdd,
  gitCommit,
  gitPush,
  gitBranchName,
  gitDiffStaged,
  ghCreatePr,
} from "../lib/git";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

describe("gitAdd", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("calls invoke with empty paths for stage-all", async () => {
    mockInvoke.mockResolvedValue(undefined);

    await gitAdd("/code/worktree");

    expect(mockInvoke).toHaveBeenCalledWith("git_add", {
      worktreePath: "/code/worktree",
      paths: [],
    });
  });

  it("calls invoke with specific paths", async () => {
    mockInvoke.mockResolvedValue(undefined);

    await gitAdd("/code/worktree", ["src/app.ts", "src/lib.ts"]);

    expect(mockInvoke).toHaveBeenCalledWith("git_add", {
      worktreePath: "/code/worktree",
      paths: ["src/app.ts", "src/lib.ts"],
    });
  });
});

describe("gitCommit", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("calls invoke with message and returns short hash", async () => {
    mockInvoke.mockResolvedValue("abc1234");

    const result = await gitCommit("/code/worktree", "feat: add thing");

    expect(mockInvoke).toHaveBeenCalledWith("git_commit", {
      worktreePath: "/code/worktree",
      message: "feat: add thing",
    });
    expect(result).toBe("abc1234");
  });
});

describe("gitPush", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("calls invoke and returns branch name", async () => {
    mockInvoke.mockResolvedValue("jrvs/feat-x");

    const result = await gitPush("/code/worktree");

    expect(mockInvoke).toHaveBeenCalledWith("git_push", {
      worktreePath: "/code/worktree",
    });
    expect(result).toBe("jrvs/feat-x");
  });
});

describe("gitBranchName", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("calls invoke and returns branch name", async () => {
    mockInvoke.mockResolvedValue("jrvs/feat-x");

    const result = await gitBranchName("/code/worktree");

    expect(mockInvoke).toHaveBeenCalledWith("git_branch_name", {
      worktreePath: "/code/worktree",
    });
    expect(result).toBe("jrvs/feat-x");
  });
});

describe("gitDiffStaged", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("calls invoke and returns staged diff string", async () => {
    mockInvoke.mockResolvedValue("diff --git a/file.ts b/file.ts\n+new line\n");

    const result = await gitDiffStaged("/code/worktree");

    expect(mockInvoke).toHaveBeenCalledWith("git_diff_staged", {
      worktreePath: "/code/worktree",
    });
    expect(result).toContain("+new line");
  });
});

describe("ghCreatePr", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("calls invoke with required args and returns PR URL", async () => {
    mockInvoke.mockResolvedValue("https://github.com/org/repo/pull/42");

    const result = await ghCreatePr("/code/repo", "feat: my pr");

    expect(mockInvoke).toHaveBeenCalledWith("gh_create_pr", {
      repoPath: "/code/repo",
      title: "feat: my pr",
      body: null,
      base: null,
      draft: false,
    });
    expect(result).toBe("https://github.com/org/repo/pull/42");
  });

  it("calls invoke with all optional args", async () => {
    mockInvoke.mockResolvedValue("https://github.com/org/repo/pull/43");

    const result = await ghCreatePr(
      "/code/repo",
      "feat: my pr",
      "Some description",
      "main",
      true,
    );

    expect(mockInvoke).toHaveBeenCalledWith("gh_create_pr", {
      repoPath: "/code/repo",
      title: "feat: my pr",
      body: "Some description",
      base: "main",
      draft: true,
    });
    expect(result).toBe("https://github.com/org/repo/pull/43");
  });

  it("passes null for undefined body and base", async () => {
    mockInvoke.mockResolvedValue("https://github.com/org/repo/pull/44");

    await ghCreatePr("/code/repo", "fix: stuff", undefined, undefined, false);

    expect(mockInvoke).toHaveBeenCalledWith("gh_create_pr", {
      repoPath: "/code/repo",
      title: "fix: stuff",
      body: null,
      base: null,
      draft: false,
    });
  });
});

// ===========================================================================
// Error path tests — verify rejection propagation
// ===========================================================================

describe("gitAdd error paths", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("propagates error when invoke rejects", async () => {
    mockInvoke.mockRejectedValueOnce("git error: pathspec did not match");
    await expect(gitAdd("/code/worktree", ["nonexistent.ts"])).rejects.toThrow(
      "pathspec did not match",
    );
  });
});

describe("gitCommit error paths", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("propagates error when invoke rejects", async () => {
    mockInvoke.mockRejectedValueOnce("git error: nothing to commit");
    await expect(gitCommit("/code/worktree", "feat: empty")).rejects.toThrow(
      "nothing to commit",
    );
  });
});

describe("gitPush error paths", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("propagates error when invoke rejects", async () => {
    mockInvoke.mockRejectedValueOnce("git error: remote rejected");
    await expect(gitPush("/code/worktree")).rejects.toThrow("remote rejected");
  });
});

describe("gitBranchName error paths", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("propagates error when invoke rejects", async () => {
    mockInvoke.mockRejectedValueOnce("git error: HEAD detached");
    await expect(gitBranchName("/code/worktree")).rejects.toThrow(
      "HEAD detached",
    );
  });
});

describe("gitDiffStaged error paths", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("propagates error when invoke rejects", async () => {
    mockInvoke.mockRejectedValueOnce("git error: bad object");
    await expect(gitDiffStaged("/code/worktree")).rejects.toThrow("bad object");
  });
});

describe("ghCreatePr error paths", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("propagates error when invoke rejects", async () => {
    mockInvoke.mockRejectedValueOnce("gh error: pull request already exists");
    await expect(ghCreatePr("/code/repo", "feat: duplicate")).rejects.toThrow(
      "pull request already exists",
    );
  });
});
