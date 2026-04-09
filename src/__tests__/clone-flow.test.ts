/**
 * Tests for clone flow — verifies git_clone wrapper and App.svelte wiring
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

import { cloneProject } from "../lib/git";

describe("cloneProject", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
  });

  it("calls git_clone invoke with url and targetDir", async () => {
    await cloneProject("git@github.com:org/repo.git", "/code/repo");
    expect(mockInvoke).toHaveBeenCalledWith("git_clone", {
      url: "git@github.com:org/repo.git",
      targetDir: "/code/repo",
    });
  });

  it("propagates errors from git_clone", async () => {
    mockInvoke.mockRejectedValue("clone failed");
    await expect(cloneProject("bad-url", "/code/repo")).rejects.toBe(
      "clone failed",
    );
  });
});

describe("App.svelte clone wiring", () => {
  it("handleAddProject handles clone via unified project dialog", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/workspace-actions.ts", "utf-8");
    expect(source).toContain("cloneProject");
    expect(source).toContain("registerProject");
    expect(source).toContain("showNewProjectDialog");
  });
});
