/**
 * Tests for buildOverviewSections and resolveDirtyPath — the pure data
 * transformations for the Workspace Overview dashboard.
 */
import { describe, it, expect } from "vitest";
import {
  buildOverviewSections,
  resolveDirtyPath,
} from "../lib/services/workspace-overview";
import type { Workspace, BranchedWorkspace } from "../lib/types";

// --- Helpers ---

function makeRoot(
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

function makeBranch(
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
    (ws as BranchedWorkspace).worktreePath = opts.worktreePath;
  }
  return ws;
}

// --- buildOverviewSections tests ---

describe("buildOverviewSections", () => {
  it("returns one section per Workspace when all Branches belong to roots", () => {
    const u1 = makeRoot("u1", "Alpha");
    const u2 = makeRoot("u2", "Beta");
    const n1 = makeBranch("n1", "branch-1", { parentWorkspaceId: "u1" });
    const n2 = makeBranch("n2", "branch-2", { parentWorkspaceId: "u2" });
    const sections = buildOverviewSections([u1, u2, n1, n2]);
    expect(sections).toHaveLength(2);
    expect(sections[0]!.workspace?.id).toBe("u1");
    expect(sections[0]!.branches).toHaveLength(1);
    expect(sections[0]!.branches[0]!.id).toBe("n1");
    expect(sections[1]!.workspace?.id).toBe("u2");
    expect(sections[1]!.branches[0]!.id).toBe("n2");
  });

  it("filters out dashboard rows", () => {
    const u1 = makeRoot("u1", "Alpha");
    const n1 = makeBranch("n1", "branch-1", { parentWorkspaceId: "u1" });
    const settings = makeBranch("settings", "Settings", {
      isDashboard: true,
    });
    const n2 = makeBranch("n2", "branch-2", {
      parentWorkspaceId: "u1",
      isDashboard: true,
    });
    const sections = buildOverviewSections([u1, n1, settings, n2]);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.branches).toHaveLength(1);
    expect(sections[0]!.branches[0]!.id).toBe("n1");
  });

  it("collects standalones (no parentWorkspaceId) under a null-workspace section at the end", () => {
    const u1 = makeRoot("u1", "Alpha");
    const n1 = makeBranch("n1", "branch-1", { parentWorkspaceId: "u1" });
    const standalone = makeBranch("standalone", "MyPersonalTab");
    const sections = buildOverviewSections([u1, n1, standalone]);
    expect(sections).toHaveLength(2);
    expect(sections[1]!.workspace).toBeNull();
    expect(sections[1]!.branches[0]!.id).toBe("standalone");
  });

  it("collects orphaned Branches (unknown parentWorkspaceId) as standalones", () => {
    const orphan = makeBranch("orphan", "Orphaned", {
      parentWorkspaceId: "ghost-workspace",
    });
    const sections = buildOverviewSections([orphan]);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.workspace).toBeNull();
    expect(sections[0]!.branches[0]!.id).toBe("orphan");
  });

  it("includes empty Workspace sections (no Branches)", () => {
    const u1 = makeRoot("u1", "Alpha");
    const u2 = makeRoot("u2", "Empty");
    const n1 = makeBranch("n1", "branch-1", { parentWorkspaceId: "u1" });
    const sections = buildOverviewSections([u1, u2, n1]);
    expect(sections).toHaveLength(2);
    expect(sections[1]!.workspace?.id).toBe("u2");
    expect(sections[1]!.branches).toHaveLength(0);
  });

  it("omits the standalone section when there are no standalones", () => {
    const u1 = makeRoot("u1", "Alpha");
    const n1 = makeBranch("n1", "branch-1", { parentWorkspaceId: "u1" });
    const sections = buildOverviewSections([u1, n1]);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.workspace?.id).toBe("u1");
  });

  it("returns empty array when input is empty", () => {
    expect(buildOverviewSections([])).toHaveLength(0);
  });

  it("preserves Workspace order from the input array", () => {
    const c = makeRoot("c", "Charlie");
    const a = makeRoot("a", "Alpha");
    const b = makeRoot("b", "Beta");
    const sections = buildOverviewSections([c, a, b]);
    expect(sections.map((s) => s.workspace?.id)).toEqual(["c", "a", "b"]);
  });
});

// --- resolveDirtyPath tests ---

describe("resolveDirtyPath", () => {
  it("returns worktreePath when present", () => {
    const ws = makeBranch("n1", "branch", {
      parentWorkspaceId: "u1",
      worktreePath: "/repos/alpha/worktree",
    });
    const root = makeRoot("u1", "Alpha", "/repos/alpha");
    expect(resolveDirtyPath(ws, root)).toBe("/repos/alpha/worktree");
  });

  it("falls back to the owning Workspace path when no worktreePath", () => {
    const ws = makeBranch("n1", "branch", { parentWorkspaceId: "u1" });
    const root = makeRoot("u1", "Alpha", "/repos/alpha");
    expect(resolveDirtyPath(ws, root)).toBe("/repos/alpha");
  });

  it("returns null for standalone workspace with no path info", () => {
    const ws = makeBranch("standalone", "Solo");
    expect(resolveDirtyPath(ws, null)).toBeNull();
  });

  it("returns null when the owning Workspace has no path and no worktreePath", () => {
    const ws = makeBranch("n1", "branch", { parentWorkspaceId: "u1" });
    const root = { ...makeRoot("u1", "Alpha"), path: "" };
    expect(resolveDirtyPath(ws, root)).toBeNull();
  });
});
