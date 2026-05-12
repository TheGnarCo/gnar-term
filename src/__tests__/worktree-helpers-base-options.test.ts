/**
 * fetchBaseOptions: groups local / remote / worktree branches for the
 * Source branch picker, sorts alphabetically within group, and reports
 * the current branch for defaulting.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

import { fetchBaseOptions } from "../lib/services/worktree-helpers";

describe("fetchBaseOptions", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("groups local branches under 'Local', remotes under 'Remote', sorted alphabetically", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "list_branches") {
        return [
          {
            name: "wip/scratch-2026-04-12",
            is_current: false,
            is_remote: false,
          },
          { name: "chore/lint-pass", is_current: false, is_remote: false },
          {
            name: "feat/agentic-core-refresh",
            is_current: true,
            is_remote: false,
          },
          {
            name: "origin/spike/rust-color-pipeline",
            is_current: false,
            is_remote: true,
          },
          {
            name: "origin/dependabot/bump-vite",
            is_current: false,
            is_remote: true,
          },
        ];
      }
      if (cmd === "list_worktrees") return [];
      return null;
    });

    const { options, currentBranch } = await fetchBaseOptions("/repos/example");

    expect(currentBranch).toBe("feat/agentic-core-refresh");

    const groups = options.map((o) => o.group);
    const values = options.map((o) => o.value);

    // Locals first (alphabetical), then remotes (alphabetical).
    expect(values).toEqual([
      "chore/lint-pass",
      "feat/agentic-core-refresh",
      "wip/scratch-2026-04-12",
      "origin/dependabot/bump-vite",
      "origin/spike/rust-color-pipeline",
    ]);
    expect(groups).toEqual(["Local", "Local", "Local", "Remote", "Remote"]);

    // Current-branch label suffix is preserved on the matching entry.
    const currentOpt = options.find(
      (o) => o.value === "feat/agentic-core-refresh",
    );
    expect(currentOpt?.label).toMatch(/\(current\)/);
  });

  it("emits branches checked out in a worktree into the 'Worktrees' group after non-worktree sections", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "list_branches") {
        return [
          { name: "dev", is_current: true, is_remote: false },
          {
            name: "fix/pty-deadlock-on-resize",
            is_current: false,
            is_remote: false,
          },
          { name: "feat/swimlane-dnd", is_current: false, is_remote: false },
          { name: "origin/dev", is_current: false, is_remote: true },
        ];
      }
      if (cmd === "list_worktrees") {
        return [
          {
            path: "/repos/example",
            head: "9af23c1",
            branch: "dev",
            is_bare: false,
          },
          {
            path: "/repos/example-swimlane-dnd",
            head: "1c8d4be",
            branch: "feat/swimlane-dnd",
            is_bare: false,
          },
        ];
      }
      return null;
    });

    const { options } = await fetchBaseOptions("/repos/example");

    // Section ordering: Local non-worktree, Remote non-worktree, then Worktrees last.
    const groups = options.map((o) => o.group);
    const lastWorktreeIdx = groups.lastIndexOf("Worktrees");
    const lastLocalIdx = groups.lastIndexOf("Local");
    const lastRemoteIdx = groups.lastIndexOf("Remote");

    expect(lastWorktreeIdx).toBeGreaterThan(lastLocalIdx);
    expect(lastWorktreeIdx).toBeGreaterThan(lastRemoteIdx);

    // Branches occupied by a worktree appear only in the Worktrees group.
    const devEntries = options.filter((o) => o.value === "dev");
    expect(devEntries).toHaveLength(1);
    expect(devEntries[0].group).toBe("Worktrees");

    const dndEntries = options.filter((o) => o.value === "feat/swimlane-dnd");
    expect(dndEntries).toHaveLength(1);
    expect(dndEntries[0].group).toBe("Worktrees");

    // Worktrees group is sorted alphabetically too.
    const worktreeValues = options
      .filter((o) => o.group === "Worktrees")
      .map((o) => o.value);
    expect(worktreeValues).toEqual(["dev", "feat/swimlane-dnd"]);
  });

  it("returns an empty options list and null currentBranch when list_branches fails", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "list_branches") throw new Error("no git");
      if (cmd === "list_worktrees") return [];
      return null;
    });

    const { options, currentBranch } = await fetchBaseOptions("/repos/none");
    expect(options).toEqual([]);
    expect(currentBranch).toBeNull();
  });
});
