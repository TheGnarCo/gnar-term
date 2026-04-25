/**
 * Tests for diff-stats-store — verifies that updateDiffStatsForWorkspace
 * correctly computes added/deleted counts from git_diff output, that it
 * silently skips non-git workspaces, and that clearDiffStats resets state.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(""),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import { invoke } from "@tauri-apps/api/core";
import { workspaces } from "../../../lib/stores/workspace";
import {
  setWorkspaceGroups,
  resetWorkspaceGroupsForTest,
} from "../../../lib/stores/workspace-groups";
import {
  diffStatsStore,
  updateDiffStatsForWorkspace,
  clearDiffStats,
} from "../diff-stats-store";

const MINIMAL_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index abc..def 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 context
-deleted line
+added line 1
+added line 2
 context
`;

describe("diff-stats-store", () => {
  beforeEach(() => {
    clearDiffStats();
    workspaces.set([]);
    resetWorkspaceGroupsForTest();
    vi.clearAllMocks();
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue("");
  });

  describe("updateDiffStatsForWorkspace", () => {
    it("correctly counts added and deleted lines from git_diff output", async () => {
      const wsId = "ws-1";
      const groupId = "grp-1";

      // Seed a workspace that belongs to a git group
      workspaces.set([
        {
          id: wsId,
          name: "My Workspace",
          activePaneId: "pane-1",
          splitRoot: {
            type: "pane",
            pane: { id: "pane-1", surfaces: [], activeSurfaceId: null },
          },
          metadata: { groupId },
        },
      ]);
      setWorkspaceGroups([
        {
          id: groupId,
          name: "My Group",
          path: "/repos/my-repo",
          color: "blue",
          isGit: true,
          workspaceIds: [wsId],
          createdAt: new Date().toISOString(),
        },
      ]);

      (invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(MINIMAL_DIFF);

      await updateDiffStatsForWorkspace(wsId);

      const stats = get(diffStatsStore)[wsId];
      expect(stats).toBeDefined();
      expect(stats!.added).toBe(2);
      expect(stats!.deleted).toBe(1);
    });

    it("stores stats under the workspace id key", async () => {
      const wsId = "ws-abc";
      const groupId = "grp-abc";

      workspaces.set([
        {
          id: wsId,
          name: "WS",
          activePaneId: "p1",
          splitRoot: {
            type: "pane",
            pane: { id: "p1", surfaces: [], activeSurfaceId: null },
          },
          metadata: { groupId },
        },
      ]);
      setWorkspaceGroups([
        {
          id: groupId,
          name: "G",
          path: "/repo",
          color: "red",
          isGit: true,
          workspaceIds: [wsId],
          createdAt: new Date().toISOString(),
        },
      ]);
      (invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(MINIMAL_DIFF);

      await updateDiffStatsForWorkspace(wsId);

      const all = get(diffStatsStore);
      expect(Object.keys(all)).toEqual([wsId]);
    });

    it("uses worktreePath from workspace metadata when present", async () => {
      const wsId = "ws-wt";

      workspaces.set([
        {
          id: wsId,
          name: "Worktree WS",
          activePaneId: "p1",
          splitRoot: {
            type: "pane",
            pane: { id: "p1", surfaces: [], activeSurfaceId: null },
          },
          metadata: { worktreePath: "/repos/feature-branch" },
        },
      ]);

      (invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(MINIMAL_DIFF);

      await updateDiffStatsForWorkspace(wsId);

      expect(invoke).toHaveBeenCalledWith("git_diff", {
        repoPath: "/repos/feature-branch",
        base: "HEAD",
      });
      const stats = get(diffStatsStore)[wsId];
      expect(stats).toBeDefined();
    });

    it("silently skips workspaces with no groupId and no worktreePath", async () => {
      const wsId = "ws-no-git";

      workspaces.set([
        {
          id: wsId,
          name: "Plain WS",
          activePaneId: "p1",
          splitRoot: {
            type: "pane",
            pane: { id: "p1", surfaces: [], activeSurfaceId: null },
          },
          // No metadata — not a git workspace
        },
      ]);

      await updateDiffStatsForWorkspace(wsId);

      expect(invoke).not.toHaveBeenCalledWith("git_diff", expect.anything());
      expect(get(diffStatsStore)[wsId]).toBeUndefined();
    });

    it("silently skips workspaces whose group has isGit = false", async () => {
      const wsId = "ws-not-git";
      const groupId = "grp-not-git";

      workspaces.set([
        {
          id: wsId,
          name: "WS",
          activePaneId: "p1",
          splitRoot: {
            type: "pane",
            pane: { id: "p1", surfaces: [], activeSurfaceId: null },
          },
          metadata: { groupId },
        },
      ]);
      setWorkspaceGroups([
        {
          id: groupId,
          name: "Non-git Group",
          path: "/not-a-repo",
          color: "gray",
          isGit: false,
          workspaceIds: [wsId],
          createdAt: new Date().toISOString(),
        },
      ]);

      await updateDiffStatsForWorkspace(wsId);

      expect(invoke).not.toHaveBeenCalledWith("git_diff", expect.anything());
      expect(get(diffStatsStore)[wsId]).toBeUndefined();
    });

    it("silently skips workspaces that don't exist in the store", async () => {
      workspaces.set([]);

      await updateDiffStatsForWorkspace("ws-nonexistent");

      expect(invoke).not.toHaveBeenCalledWith("git_diff", expect.anything());
      expect(get(diffStatsStore)["ws-nonexistent"]).toBeUndefined();
    });

    it("silently skips on git_diff invocation error", async () => {
      const wsId = "ws-err";
      const groupId = "grp-err";

      workspaces.set([
        {
          id: wsId,
          name: "WS",
          activePaneId: "p1",
          splitRoot: {
            type: "pane",
            pane: { id: "p1", surfaces: [], activeSurfaceId: null },
          },
          metadata: { groupId },
        },
      ]);
      setWorkspaceGroups([
        {
          id: groupId,
          name: "G",
          path: "/repo",
          color: "red",
          isGit: true,
          workspaceIds: [wsId],
          createdAt: new Date().toISOString(),
        },
      ]);
      (invoke as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("not a git repo"),
      );

      // Should not throw
      await expect(updateDiffStatsForWorkspace(wsId)).resolves.toBeUndefined();
      expect(get(diffStatsStore)[wsId]).toBeUndefined();
    });

    it("preserves existing stats for other workspaces when updating one", async () => {
      const wsId1 = "ws-1";
      const wsId2 = "ws-2";
      const groupId = "grp-1";

      workspaces.set([
        {
          id: wsId1,
          name: "WS 1",
          activePaneId: "p1",
          splitRoot: {
            type: "pane",
            pane: { id: "p1", surfaces: [], activeSurfaceId: null },
          },
          metadata: { groupId },
        },
        {
          id: wsId2,
          name: "WS 2",
          activePaneId: "p2",
          splitRoot: {
            type: "pane",
            pane: { id: "p2", surfaces: [], activeSurfaceId: null },
          },
          metadata: { groupId },
        },
      ]);
      setWorkspaceGroups([
        {
          id: groupId,
          name: "G",
          path: "/repo",
          color: "blue",
          isGit: true,
          workspaceIds: [wsId1, wsId2],
          createdAt: new Date().toISOString(),
        },
      ]);

      (invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(MINIMAL_DIFF);
      await updateDiffStatsForWorkspace(wsId1);

      (invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(MINIMAL_DIFF);
      await updateDiffStatsForWorkspace(wsId2);

      const all = get(diffStatsStore);
      expect(all[wsId1]).toBeDefined();
      expect(all[wsId2]).toBeDefined();
    });
  });

  describe("clearDiffStats", () => {
    it("resets the store to an empty object", async () => {
      const wsId = "ws-clear";
      const groupId = "grp-clear";

      workspaces.set([
        {
          id: wsId,
          name: "WS",
          activePaneId: "p1",
          splitRoot: {
            type: "pane",
            pane: { id: "p1", surfaces: [], activeSurfaceId: null },
          },
          metadata: { groupId },
        },
      ]);
      setWorkspaceGroups([
        {
          id: groupId,
          name: "G",
          path: "/repo",
          color: "blue",
          isGit: true,
          workspaceIds: [wsId],
          createdAt: new Date().toISOString(),
        },
      ]);
      (invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(MINIMAL_DIFF);
      await updateDiffStatsForWorkspace(wsId);

      // Verify stats were populated
      expect(get(diffStatsStore)[wsId]).toBeDefined();

      clearDiffStats();

      expect(get(diffStatsStore)).toEqual({});
    });

    it("is a no-op when called on an already-empty store", () => {
      expect(() => clearDiffStats()).not.toThrow();
      expect(get(diffStatsStore)).toEqual({});
    });
  });
});
