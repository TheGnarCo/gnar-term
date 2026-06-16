/**
 * Tests for grouped-workspace serialization — serializeWorkspace /
 * serializeLayout / workspaceDefToTemplate round-trips. Confirms in-scope
 * grouping fields survive and out-of-scope (dashboard/controlled/ssh/registry)
 * fields never appear.
 */
import { describe, it, expect } from "vitest";
import {
  serializeWorkspace,
  serializeLayout,
  workspaceDefToTemplate,
} from "../lib/config";
import type { Workspace, Pane, SplitNode, Surface } from "../lib/types";

function terminalSurface(id: string, cwd?: string): Surface {
  return {
    kind: "terminal",
    id,
    terminal: {} as any,
    fitAddon: {} as any,
    searchAddon: {} as any,
    termElement: document.createElement("div"),
    ptyId: 1,
    title: `term ${id}`,
    cwd,
    startupCommand: "echo hi",
    hasUnread: false,
    opened: true,
  };
}

function previewSurface(id: string): Surface {
  return {
    kind: "preview",
    id,
    filePath: `/docs/${id}.md`,
    title: `preview ${id}`,
    element: document.createElement("div"),
    watchId: 2,
    hasUnread: false,
  };
}

function workspaceWith(splitRoot: SplitNode, overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "anchor-1",
    name: "Anchor",
    splitRoot,
    activePaneId: "p1",
    ...overrides,
  };
}

describe("serializeLayout", () => {
  it("serializes a terminal surface with cwd / command / focus", () => {
    const pane: Pane = {
      id: "p1",
      surfaces: [terminalSurface("s1", "/work")],
      activeSurfaceId: "s1",
    };
    const layout = serializeLayout({ type: "pane", pane });
    expect(layout).toEqual({
      pane: {
        surfaces: [
          {
            type: "terminal",
            name: "term s1",
            cwd: "/work",
            command: "echo hi",
            focus: true,
          },
        ],
      },
    });
  });

  it("serializes a preview surface as a markdown panel with its path", () => {
    const pane: Pane = {
      id: "p1",
      surfaces: [previewSurface("s2")],
      activeSurfaceId: "s2",
    };
    const layout = serializeLayout({ type: "pane", pane });
    expect(layout).toEqual({
      pane: {
        surfaces: [
          {
            type: "markdown",
            name: "preview s2",
            path: "/docs/s2.md",
            focus: true,
          },
        ],
      },
    });
  });

  it("never emits ssh or registry surface branches", () => {
    const pane: Pane = {
      id: "p1",
      surfaces: [terminalSurface("s1"), previewSurface("s2")],
      activeSurfaceId: "s1",
    };
    const layout = serializeLayout({ type: "pane", pane });
    const json = JSON.stringify(layout);
    expect(json).not.toContain("ssh");
    expect(json).not.toContain("registry");
    expect(json).not.toContain("extensionType");
  });

  it("recurses into split nodes preserving direction + ratio", () => {
    const left: SplitNode = {
      type: "pane",
      pane: { id: "p1", surfaces: [terminalSurface("s1")], activeSurfaceId: "s1" },
    };
    const right: SplitNode = {
      type: "pane",
      pane: { id: "p2", surfaces: [terminalSurface("s2")], activeSurfaceId: "s2" },
    };
    const layout = serializeLayout({
      type: "split",
      direction: "vertical",
      ratio: 0.3,
      children: [left, right],
    });
    expect(layout).toMatchObject({ direction: "vertical", split: 0.3 });
  });
});

describe("serializeWorkspace", () => {
  const pane: Pane = {
    id: "p1",
    surfaces: [terminalSurface("s1", "/repo")],
    activeSurfaceId: "s1",
  };
  const splitRoot: SplitNode = { type: "pane", pane };

  it("round-trips in-scope grouping fields", () => {
    const ws = workspaceWith(splitRoot, {
      color: "#abc",
      memberWorkspaceIds: ["m1", "m2"],
      isGit: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      worktree: { path: "/wt", branch: "feature", baseBranch: "main", repoPath: "/repo" },
    });
    const def = serializeWorkspace(ws);
    expect(def.id).toBe("anchor-1");
    expect(def.name).toBe("Anchor");
    expect(def.color).toBe("#abc");
    expect(def.memberWorkspaceIds).toEqual(["m1", "m2"]);
    expect(def.isGit).toBe(true);
    expect(def.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(def.worktree).toEqual({
      path: "/wt",
      branch: "feature",
      baseBranch: "main",
      repoPath: "/repo",
    });
    expect(def.layout).toBeDefined();
  });

  it("serializes a member's anchor back-reference", () => {
    const member = workspaceWith(splitRoot, {
      id: "m1",
      anchorWorkspaceId: "anchor-1",
    });
    const def = serializeWorkspace(member);
    expect(def.anchorWorkspaceId).toBe("anchor-1");
    expect(def.memberWorkspaceIds).toBeUndefined();
  });

  it("omits absent optional fields and never emits dropped fields", () => {
    const ws = workspaceWith(splitRoot);
    const def = serializeWorkspace(ws);
    expect(def.color).toBeUndefined();
    expect(def.anchorWorkspaceId).toBeUndefined();
    expect(def.worktree).toBeUndefined();
    const json = JSON.stringify(def);
    for (const dropped of [
      "isDashboard",
      "dashboardWorkspaceId",
      "controlled",
      "spawnedBy",
      "rootWorkspaceId",
      "branchedWorkspaceIds",
    ]) {
      expect(json).not.toContain(dropped);
    }
  });
});

describe("workspaceDefToTemplate", () => {
  it("round-trips a grouped def through serialize → template", () => {
    const pane: Pane = {
      id: "p1",
      surfaces: [terminalSurface("s1", "/repo")],
      activeSurfaceId: "s1",
    };
    const ws = workspaceWith(
      { type: "pane", pane },
      {
        color: "#def",
        memberWorkspaceIds: ["m1"],
        lastActiveMemberWorkspaceId: "m1",
        path: "/repo",
        isGit: true,
        locked: true,
        worktree: { path: "/wt", branch: "feature" },
      },
    );
    const def = serializeWorkspace(ws);
    const tpl = workspaceDefToTemplate(def);
    expect(tpl.id).toBe("anchor-1");
    expect(tpl.color).toBe("#def");
    expect(tpl.memberWorkspaceIds).toEqual(["m1"]);
    expect(tpl.lastActiveMemberWorkspaceId).toBe("m1");
    expect(tpl.path).toBe("/repo");
    expect(tpl.isGit).toBe(true);
    expect(tpl.locked).toBe(true);
    expect(tpl.worktree).toEqual({ path: "/wt", branch: "feature" });
    expect(tpl.layout).toBe(def.layout);
  });

  it("passes through cwd and drops nothing in-scope", () => {
    const tpl = workspaceDefToTemplate({
      id: "x",
      name: "X",
      cwd: "/home",
      anchorWorkspaceId: "anchor-1",
    });
    expect(tpl.cwd).toBe("/home");
    expect(tpl.anchorWorkspaceId).toBe("anchor-1");
  });
});
