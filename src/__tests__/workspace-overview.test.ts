/**
 * Tests for buildGroups and resolveDirtyPath — the pure data
 * transformations for the Workspace Overview dashboard.
 */
import { describe, it, expect } from "vitest";
import {
  buildGroups,
  resolveDirtyPath,
} from "../lib/services/workspace-overview";
import type { Workspace } from "../lib/types";

// --- Helpers ---

function makePrimary(
  id: string,
  name: string,
  path = "/projects/" + id,
): Workspace {
  return {
    id,
    name,
    path,
    splitRoot: {
      type: "pane",
      pane: { id: `pane-${id}`, surfaces: [], activeSurfaceId: null },
    },
    activePaneId: `pane-${id}`,
  };
}

function makeChild(
  id: string,
  name: string,
  opts: {
    parentWorkspaceId?: string;
    isDashboard?: boolean;
    worktreePath?: string;
  } = {},
): Workspace {
  const ws: Workspace = {
    id,
    name,
    splitRoot: {
      type: "pane",
      pane: { id: `pane-${id}`, surfaces: [], activeSurfaceId: null },
    },
    activePaneId: `pane-${id}`,
  };
  if (opts.parentWorkspaceId) ws.parentWorkspaceId = opts.parentWorkspaceId;
  if (opts.isDashboard) ws.isDashboard = true;
  if (opts.worktreePath) {
    (ws as Workspace & { worktreePath: string }).worktreePath =
      opts.worktreePath;
  }
  return ws;
}

// --- buildGroups tests ---

describe("buildGroups", () => {
  it("returns one group per primary workspace when all children belong to primaries", () => {
    const u1 = makePrimary("u1", "Alpha");
    const u2 = makePrimary("u2", "Beta");
    const n1 = makeChild("n1", "branch-1", { parentWorkspaceId: "u1" });
    const n2 = makeChild("n2", "branch-2", { parentWorkspaceId: "u2" });
    const groups = buildGroups([u1, u2, n1, n2]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.workspace?.id).toBe("u1");
    expect(groups[0]!.rows).toHaveLength(1);
    expect(groups[0]!.rows[0]!.id).toBe("n1");
    expect(groups[1]!.workspace?.id).toBe("u2");
    expect(groups[1]!.rows[0]!.id).toBe("n2");
  });

  it("filters out dashboard child workspaces", () => {
    const u1 = makePrimary("u1", "Alpha");
    const n1 = makeChild("n1", "branch-1", { parentWorkspaceId: "u1" });
    const settings = makeChild("settings", "Settings", {
      isDashboard: true,
    });
    const n2 = makeChild("n2", "branch-2", {
      parentWorkspaceId: "u1",
      isDashboard: true,
    });
    const groups = buildGroups([u1, n1, settings, n2]);
    // Only n1 should appear — both dashboard entries are excluded
    expect(groups).toHaveLength(1);
    expect(groups[0]!.rows).toHaveLength(1);
    expect(groups[0]!.rows[0]!.id).toBe("n1");
  });

  it("collects standalones (no parentWorkspaceId) under a null-workspace group at the end", () => {
    const u1 = makePrimary("u1", "Alpha");
    const n1 = makeChild("n1", "branch-1", { parentWorkspaceId: "u1" });
    const standalone = makeChild("standalone", "MyPersonalTab");
    const groups = buildGroups([u1, n1, standalone]);
    expect(groups).toHaveLength(2);
    expect(groups[1]!.workspace).toBeNull();
    expect(groups[1]!.rows[0]!.id).toBe("standalone");
  });

  it("collects orphaned children (unknown parentWorkspaceId) as standalones", () => {
    const orphan = makeChild("orphan", "Orphaned", {
      parentWorkspaceId: "ghost-workspace",
    });
    const groups = buildGroups([orphan]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.workspace).toBeNull();
    expect(groups[0]!.rows[0]!.id).toBe("orphan");
  });

  it("includes empty primary groups (no child workspaces)", () => {
    const u1 = makePrimary("u1", "Alpha");
    const u2 = makePrimary("u2", "Empty");
    const n1 = makeChild("n1", "branch-1", { parentWorkspaceId: "u1" });
    const groups = buildGroups([u1, u2, n1]);
    expect(groups).toHaveLength(2);
    expect(groups[1]!.workspace?.id).toBe("u2");
    expect(groups[1]!.rows).toHaveLength(0);
  });

  it("omits the standalone group when there are no standalones", () => {
    const u1 = makePrimary("u1", "Alpha");
    const n1 = makeChild("n1", "branch-1", { parentWorkspaceId: "u1" });
    const groups = buildGroups([u1, n1]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.workspace?.id).toBe("u1");
  });

  it("returns empty array when input is empty", () => {
    expect(buildGroups([])).toHaveLength(0);
  });

  it("preserves primary workspace order from the input array", () => {
    const c = makePrimary("c", "Charlie");
    const a = makePrimary("a", "Alpha");
    const b = makePrimary("b", "Beta");
    const groups = buildGroups([c, a, b]);
    expect(groups.map((g) => g.workspace?.id)).toEqual(["c", "a", "b"]);
  });
});

// --- resolveDirtyPath tests ---

describe("resolveDirtyPath", () => {
  it("returns worktreePath when present", () => {
    const ws = makeChild("n1", "branch", {
      worktreePath: "/repos/alpha/worktree",
    });
    const primary = makePrimary("u1", "Alpha", "/repos/alpha");
    expect(resolveDirtyPath(ws, primary)).toBe("/repos/alpha/worktree");
  });

  it("falls back to primary path when no worktreePath", () => {
    const ws = makeChild("n1", "branch", { parentWorkspaceId: "u1" });
    const primary = makePrimary("u1", "Alpha", "/repos/alpha");
    expect(resolveDirtyPath(ws, primary)).toBe("/repos/alpha");
  });

  it("returns null for standalone workspace with no path info", () => {
    const ws = makeChild("standalone", "Solo");
    expect(resolveDirtyPath(ws, null)).toBeNull();
  });

  it("returns null when primary has no path and no worktreePath", () => {
    const ws = makeChild("n1", "branch", { parentWorkspaceId: "u1" });
    const primary = { ...makePrimary("u1", "Alpha"), path: "" };
    expect(resolveDirtyPath(ws, primary)).toBeNull();
  });
});
