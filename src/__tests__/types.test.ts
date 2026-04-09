/**
 * Tests for the types module — discriminated union, tree traversal, type guards
 */
import { describe, it, expect } from "vitest";
import {
  uid,
  getAllPanes,
  getAllSurfaces,
  isTerminalSurface,
  isPreviewSurface,
  isHarnessSurface,
  isDiffSurface,
  isFileBrowserSurface,
  isCommitHistorySurface,
  type Pane,
  type SplitNode,
  type Workspace,
  type TerminalSurface,
  type PreviewSurface,
  type HarnessSurface,
  type DiffSurface,
  type FileBrowserSurface,
  type CommitHistorySurface,
  type WorkspaceType,
  type WorkspaceStatus,
  type WorkspaceRecord,
  type HarnessPreset,
  type AgentStatus,
  type Surface,
} from "../lib/types";

function makeMockTerminalSurface(id: string): TerminalSurface {
  return {
    kind: "terminal",
    id,
    terminal: {} as any,
    fitAddon: { fit: () => {} } as any,
    searchAddon: {} as any,
    termElement: document.createElement("div"),
    ptyId: 1,
    title: `Terminal ${id}`,
    hasUnread: false,
    opened: true,
  };
}

function makeMockPreviewSurface(id: string): PreviewSurface {
  return {
    kind: "preview",
    id,
    filePath: `/path/${id}.md`,
    title: `Preview ${id}`,
    element: document.createElement("div"),
    watchId: 1,
    hasUnread: false,
  };
}

describe("uid()", () => {
  it("generates unique IDs", () => {
    const ids = new Set([uid(), uid(), uid(), uid(), uid()]);
    expect(ids.size).toBe(5);
  });

  it("IDs start with 'id-'", () => {
    expect(uid()).toMatch(/^id-/);
  });
});

describe("isTerminalSurface / isPreviewSurface type guards", () => {
  it("correctly identifies terminal surfaces", () => {
    const ts = makeMockTerminalSurface("t1");
    expect(isTerminalSurface(ts)).toBe(true);
    expect(isPreviewSurface(ts)).toBe(false);
  });

  it("correctly identifies preview surfaces", () => {
    const ps = makeMockPreviewSurface("p1");
    expect(isTerminalSurface(ps)).toBe(false);
    expect(isPreviewSurface(ps)).toBe(true);
  });
});

describe("getAllPanes()", () => {
  it("returns single pane from leaf node", () => {
    const pane: Pane = { id: "p1", surfaces: [], activeSurfaceId: null };
    const node: SplitNode = { type: "pane", pane };
    expect(getAllPanes(node)).toEqual([pane]);
  });

  it("returns all panes from a split tree", () => {
    const p1: Pane = { id: "p1", surfaces: [], activeSurfaceId: null };
    const p2: Pane = { id: "p2", surfaces: [], activeSurfaceId: null };
    const p3: Pane = { id: "p3", surfaces: [], activeSurfaceId: null };

    const tree: SplitNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { type: "pane", pane: p1 },
        {
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          children: [
            { type: "pane", pane: p2 },
            { type: "pane", pane: p3 },
          ],
        },
      ],
    };

    const panes = getAllPanes(tree);
    expect(panes).toHaveLength(3);
    expect(panes.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });
});

describe("getAllSurfaces()", () => {
  it("returns all surfaces from a workspace", () => {
    const t1 = makeMockTerminalSurface("t1");
    const p1 = makeMockPreviewSurface("p1");
    const t2 = makeMockTerminalSurface("t2");

    const pane1: Pane = {
      id: "pane1",
      surfaces: [t1, p1],
      activeSurfaceId: "t1",
    };
    const pane2: Pane = { id: "pane2", surfaces: [t2], activeSurfaceId: "t2" };

    const ws: Workspace = {
      id: "ws1",
      name: "Test",
      splitRoot: {
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        children: [
          { type: "pane", pane: pane1 },
          { type: "pane", pane: pane2 },
        ],
      },
      activePaneId: "pane1",
    };

    const surfaces = getAllSurfaces(ws);
    expect(surfaces).toHaveLength(3);
    expect(surfaces.map((s) => s.id)).toEqual(["t1", "p1", "t2"]);
  });

  it("correctly mixes terminal and preview surfaces", () => {
    const t1 = makeMockTerminalSurface("t1");
    const p1 = makeMockPreviewSurface("p1");

    const pane: Pane = {
      id: "pane1",
      surfaces: [t1, p1],
      activeSurfaceId: "t1",
    };
    const ws: Workspace = {
      id: "ws1",
      name: "Test",
      splitRoot: { type: "pane", pane },
      activePaneId: "pane1",
    };

    const surfaces = getAllSurfaces(ws);
    expect(surfaces[0].kind).toBe("terminal");
    expect(surfaces[1].kind).toBe("preview");
    expect(isTerminalSurface(surfaces[0])).toBe(true);
    expect(isPreviewSurface(surfaces[1])).toBe(true);
  });
});

// --- New domain types ---

function makeMockHarnessSurface(id: string): HarnessSurface {
  return {
    kind: "harness",
    id,
    presetId: "claude",
    terminal: {} as any,
    fitAddon: { fit: () => {} } as any,
    searchAddon: {} as any,
    termElement: document.createElement("div"),
    ptyId: 2,
    status: "idle",
    title: `Claude Code ${id}`,
    hasUnread: false,
    opened: true,
  };
}

describe("HarnessSurface", () => {
  it("isHarnessSurface correctly identifies harness surfaces", () => {
    const h = makeMockHarnessSurface("h1");
    expect(isHarnessSurface(h)).toBe(true);
    expect(isTerminalSurface(h as unknown as Surface)).toBe(false);
    expect(isPreviewSurface(h as unknown as Surface)).toBe(false);
  });

  it("isHarnessSurface returns false for terminal surfaces", () => {
    const t = makeMockTerminalSurface("t1");
    expect(isHarnessSurface(t as unknown as Surface)).toBe(false);
  });

  it("includes harness surfaces in pane surface list", () => {
    const h1 = makeMockHarnessSurface("h1");
    const t1 = makeMockTerminalSurface("t1");
    const pane: Pane = { id: "p1", surfaces: [h1, t1], activeSurfaceId: "h1" };
    const ws: Workspace = {
      id: "ws1",
      name: "Test",
      splitRoot: { type: "pane", pane },
      activePaneId: "p1",
    };

    const surfaces = getAllSurfaces(ws);
    expect(surfaces).toHaveLength(2);
    expect(surfaces[0].kind).toBe("harness");
    expect(surfaces[1].kind).toBe("terminal");
  });
});

describe("New surface type guards", () => {
  it("isDiffSurface correctly identifies diff surfaces", () => {
    const diff: DiffSurface = {
      kind: "diff",
      id: "d1",
      title: "Diff",
      worktreePath: "/repo",
      diffContent: "+added line",
      hasUnread: false,
    };
    expect(isDiffSurface(diff)).toBe(true);
    expect(isTerminalSurface(diff as unknown as Surface)).toBe(false);
  });

  it("isFileBrowserSurface correctly identifies file browser surfaces", () => {
    const fb: FileBrowserSurface = {
      kind: "filebrowser",
      id: "fb1",
      title: "Files",
      worktreePath: "/repo",
      files: ["src/app.ts"],
      hasUnread: false,
    };
    expect(isFileBrowserSurface(fb)).toBe(true);
    expect(isDiffSurface(fb as unknown as Surface)).toBe(false);
  });

  it("isCommitHistorySurface correctly identifies commit history surfaces", () => {
    const ch: CommitHistorySurface = {
      kind: "commithistory",
      id: "ch1",
      title: "Commits",
      worktreePath: "/repo",
      commits: [
        {
          hash: "abc",
          shortHash: "abc",
          subject: "test",
          author: "dev",
          date: "2026-01-01",
        },
      ],
      hasUnread: false,
    };
    expect(isCommitHistorySurface(ch)).toBe(true);
    expect(isFileBrowserSurface(ch as unknown as Surface)).toBe(false);
  });

  it("Surface union accepts all six surface kinds", () => {
    const kinds = [
      "terminal",
      "preview",
      "harness",
      "diff",
      "filebrowser",
      "commithistory",
    ];
    const surfaces: Surface[] = [
      makeMockTerminalSurface("t1"),
      {
        kind: "preview",
        id: "p1",
        filePath: "/f",
        title: "P",
        element: document.createElement("div"),
        watchId: 0,
        hasUnread: false,
      } as PreviewSurface,
      makeMockHarnessSurface("h1"),
      {
        kind: "diff",
        id: "d1",
        title: "D",
        worktreePath: "/r",
        diffContent: "",
        hasUnread: false,
      } as DiffSurface,
      {
        kind: "filebrowser",
        id: "fb1",
        title: "FB",
        worktreePath: "/r",
        files: [],
        hasUnread: false,
      } as FileBrowserSurface,
      {
        kind: "commithistory",
        id: "ch1",
        title: "CH",
        worktreePath: "/r",
        commits: [],
        hasUnread: false,
      } as CommitHistorySurface,
    ];
    expect(surfaces.map((s) => s.kind)).toEqual(kinds);
  });
});

describe("AgentStatus", () => {
  it("accepts all valid status values", () => {
    const statuses: AgentStatus[] = [
      "idle",
      "running",
      "waiting",
      "error",
      "exited",
    ];
    expect(statuses).toHaveLength(5);
  });
});

describe("ProjectState (from state.ts)", () => {
  it("can be constructed with required fields", () => {
    const project = {
      id: "proj_1",
      name: "gnar-term",
      path: "/Users/jarvis/code/gnar-term",
      active: true,
      gitBacked: true,
      color: "#e06c75",
      workspaces: [],
    };
    expect(project.id).toBe("proj_1");
    expect(project.name).toBe("gnar-term");
    expect(project.remote).toBeUndefined();
  });
});

describe("WorkspaceRecord", () => {
  it("can be constructed for a terminal workspace", () => {
    const meta: WorkspaceRecord = {
      id: "ws_001",
      type: "terminal",
      name: "Terminal",
      status: "active",
      projectId: "proj_abc",
    };
    expect(meta.type).toBe("terminal");
    expect(meta.branch).toBeUndefined();
  });

  it("can be constructed for a managed workspace", () => {
    const meta: WorkspaceRecord = {
      id: "ws_002",
      type: "managed",
      name: "Add auth flow",
      status: "active",
      projectId: "proj_abc",
      branch: "jrvs/add-auth-flow",
      baseBranch: "main",
      worktreePath: "/Users/jarvis/code/gnar-term-worktrees/jrvs/add-auth-flow",
    };
    expect(meta.type).toBe("managed");
    expect(meta.projectId).toBe("proj_abc");
    expect(meta.branch).toBe("jrvs/add-auth-flow");
    expect(meta.baseBranch).toBe("main");
    expect(meta.worktreePath).toBeDefined();
  });

  it("supports all workspace statuses", () => {
    const statuses: WorkspaceStatus[] = ["active", "stashed", "archived"];
    expect(statuses).toHaveLength(3);
  });

  it("supports all workspace types", () => {
    const types: WorkspaceType[] = ["terminal", "managed"];
    expect(types).toHaveLength(2);
  });
});

describe("HarnessPreset", () => {
  it("can be constructed with all fields", () => {
    const preset: HarnessPreset = {
      id: "claude",
      name: "Claude Code",
      command: "claude",
      args: [],
      env: {},
    };
    expect(preset.id).toBe("claude");
    expect(preset.command).toBe("claude");
    expect(preset.icon).toBeUndefined();
  });

  it("accepts optional icon", () => {
    const preset: HarnessPreset = {
      id: "claude",
      name: "Claude Code",
      command: "claude",
      args: ["--permission-mode", "plan"],
      env: { CLAUDE_MODEL: "opus" },
      icon: "claude",
    };
    expect(preset.icon).toBe("claude");
    expect(preset.args).toHaveLength(2);
  });
});

describe("Workspace with meta fields", () => {
  it("existing workspaces still work without meta fields", () => {
    const ws: Workspace = {
      id: "ws1",
      name: "Test",
      splitRoot: {
        type: "pane",
        pane: { id: "p1", surfaces: [], activeSurfaceId: null },
      },
      activePaneId: "p1",
    };
    expect(ws.record).toBeUndefined();
  });

  it("workspaces can include record", () => {
    const record: WorkspaceRecord = {
      id: "ws_001",
      type: "managed",
      name: "Feature X",
      status: "active",
      branch: "jrvs/feat-x",
      baseBranch: "main",
      worktreePath: "/tmp/worktree",
    };
    const ws: Workspace = {
      id: "ws1",
      name: "Feature X",
      splitRoot: {
        type: "pane",
        pane: { id: "p1", surfaces: [], activeSurfaceId: null },
      },
      activePaneId: "p1",
      record,
    };
    expect(ws.record?.type).toBe("managed");
    expect(ws.record?.branch).toBe("jrvs/feat-x");
  });
});
