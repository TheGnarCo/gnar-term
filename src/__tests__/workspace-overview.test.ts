/**
 * Tests for buildGroups and resolveDirtyPath — the pure data
 * transformations for the Workspace Overview dashboard.
 */
import { describe, it, expect } from "vitest";
import {
  buildGroups,
  resolveDirtyPath,
} from "../lib/services/workspace-overview";
import type { NestedWorkspace } from "../lib/types";
import type { Workspace } from "../lib/config";

// --- Helpers ---

function makeUmbrella(
  id: string,
  name: string,
  path = "/projects/" + id,
): Workspace {
  return {
    id,
    name,
    color: "#aaa",
    path,
    nestedWorkspaceIds: [],
    isGit: true,
    createdAt: new Date().toISOString(),
  };
}

function makeNested(
  id: string,
  name: string,
  opts: {
    parentWorkspaceId?: string;
    isDashboard?: boolean;
    worktreePath?: string;
  } = {},
): NestedWorkspace {
  return {
    id,
    name,
    splitRoot: {
      type: "pane",
      pane: { id: `pane-${id}`, surfaces: [], activeSurfaceId: null },
    },
    activePaneId: `pane-${id}`,
    metadata:
      opts.parentWorkspaceId || opts.isDashboard || opts.worktreePath
        ? {
            ...(opts.parentWorkspaceId
              ? { parentWorkspaceId: opts.parentWorkspaceId }
              : {}),
            ...(opts.isDashboard ? { isDashboard: true } : {}),
            ...(opts.worktreePath ? { worktreePath: opts.worktreePath } : {}),
          }
        : undefined,
  };
}

// --- buildGroups tests ---

describe("buildGroups", () => {
  it("returns one group per umbrella when all nested workspaces belong to umbrellas", () => {
    const umbrellas = [makeUmbrella("u1", "Alpha"), makeUmbrella("u2", "Beta")];
    const nested = [
      makeNested("n1", "branch-1", { parentWorkspaceId: "u1" }),
      makeNested("n2", "branch-2", { parentWorkspaceId: "u2" }),
    ];
    const groups = buildGroups(umbrellas, nested);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.umbrella?.id).toBe("u1");
    expect(groups[0]!.rows).toHaveLength(1);
    expect(groups[0]!.rows[0]!.id).toBe("n1");
    expect(groups[1]!.umbrella?.id).toBe("u2");
    expect(groups[1]!.rows[0]!.id).toBe("n2");
  });

  it("filters out dashboard nested workspaces", () => {
    const umbrellas = [makeUmbrella("u1", "Alpha")];
    const nested = [
      makeNested("n1", "branch-1", { parentWorkspaceId: "u1" }),
      makeNested("settings", "Settings", { isDashboard: true }),
      makeNested("n2", "branch-2", {
        parentWorkspaceId: "u1",
        isDashboard: true,
      }),
    ];
    const groups = buildGroups(umbrellas, nested);
    // Only n1 should appear — both dashboard entries are excluded
    expect(groups).toHaveLength(1);
    expect(groups[0]!.rows).toHaveLength(1);
    expect(groups[0]!.rows[0]!.id).toBe("n1");
  });

  it("collects standalones (no parentWorkspaceId) under a null-umbrella group at the end", () => {
    const umbrellas = [makeUmbrella("u1", "Alpha")];
    const nested = [
      makeNested("n1", "branch-1", { parentWorkspaceId: "u1" }),
      makeNested("standalone", "MyPersonalTab"),
    ];
    const groups = buildGroups(umbrellas, nested);
    expect(groups).toHaveLength(2);
    expect(groups[1]!.umbrella).toBeNull();
    expect(groups[1]!.rows[0]!.id).toBe("standalone");
  });

  it("collects orphaned nested workspaces (unknown parentWorkspaceId) as standalones", () => {
    const nested = [
      makeNested("orphan", "Orphaned", { parentWorkspaceId: "ghost-umbrella" }),
    ];
    const groups = buildGroups([], nested);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.umbrella).toBeNull();
    expect(groups[0]!.rows[0]!.id).toBe("orphan");
  });

  it("includes empty umbrella groups (no nested workspaces)", () => {
    const umbrellas = [
      makeUmbrella("u1", "Alpha"),
      makeUmbrella("u2", "Empty"),
    ];
    const nested = [makeNested("n1", "branch-1", { parentWorkspaceId: "u1" })];
    const groups = buildGroups(umbrellas, nested);
    expect(groups).toHaveLength(2);
    expect(groups[1]!.umbrella?.id).toBe("u2");
    expect(groups[1]!.rows).toHaveLength(0);
  });

  it("omits the standalone group when there are no standalones", () => {
    const umbrellas = [makeUmbrella("u1", "Alpha")];
    const nested = [makeNested("n1", "branch-1", { parentWorkspaceId: "u1" })];
    const groups = buildGroups(umbrellas, nested);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.umbrella?.id).toBe("u1");
  });

  it("returns empty array when both inputs are empty", () => {
    expect(buildGroups([], [])).toHaveLength(0);
  });

  it("preserves umbrella order from the workspaces array", () => {
    const umbrellas = [
      makeUmbrella("c", "Charlie"),
      makeUmbrella("a", "Alpha"),
      makeUmbrella("b", "Beta"),
    ];
    const groups = buildGroups(umbrellas, []);
    expect(groups.map((g) => g.umbrella?.id)).toEqual(["c", "a", "b"]);
  });
});

// --- resolveDirtyPath tests ---

describe("resolveDirtyPath", () => {
  it("returns worktreePath when present", () => {
    const nw = makeNested("n1", "branch", {
      worktreePath: "/repos/alpha/worktree",
    });
    const umbrella = makeUmbrella("u1", "Alpha", "/repos/alpha");
    expect(resolveDirtyPath(nw, umbrella)).toBe("/repos/alpha/worktree");
  });

  it("falls back to umbrella path when no worktreePath", () => {
    const nw = makeNested("n1", "branch", { parentWorkspaceId: "u1" });
    const umbrella = makeUmbrella("u1", "Alpha", "/repos/alpha");
    expect(resolveDirtyPath(nw, umbrella)).toBe("/repos/alpha");
  });

  it("returns null for standalone nested workspace with no path info", () => {
    const nw = makeNested("standalone", "Solo");
    expect(resolveDirtyPath(nw, null)).toBeNull();
  });

  it("returns null when umbrella has no path and no worktreePath", () => {
    const nw = makeNested("n1", "branch", { parentWorkspaceId: "u1" });
    const umbrella = { ...makeUmbrella("u1", "Alpha"), path: "" };
    expect(resolveDirtyPath(nw, umbrella)).toBeNull();
  });
});
