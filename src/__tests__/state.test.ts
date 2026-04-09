/**
 * Tests for the state system — state.json loading, saving, project/workspace CRUD
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  DEFAULT_STATE,
  loadState,
  saveState,
  getState,
  addProject,
  removeProject,
  addWorkspace,
  removeWorkspace,
  updateWorkspaceStatus,
  _resetForTesting,
  type AppState,
  type ProjectState,
} from "../lib/state";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

function setupInvoke(files: Record<string, string>) {
  mockInvoke.mockImplementation(async (cmd: string, args?: any) => {
    if (cmd === "get_home") return "/Users/test";
    if (cmd === "read_file") {
      const path = (args as any)?.path;
      if (path && files[path]) return files[path];
      throw new Error(`File not found: ${path}`);
    }
    if (cmd === "write_file") return undefined;
    if (cmd === "ensure_dir") return undefined;
    throw new Error(`Unknown command: ${cmd}`);
  });
}

describe("DEFAULT_STATE", () => {
  it("starts with no projects", () => {
    expect(DEFAULT_STATE.projects).toEqual([]);
  });
});

describe("loadState()", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    _resetForTesting();
  });

  it("returns defaults when no state file exists", async () => {
    setupInvoke({});
    const state = await loadState();
    expect(state.projects).toEqual([]);
  });

  it("loads state from file", async () => {
    const saved: AppState = {
      projects: [
        {
          id: "proj_1",
          name: "gnar-term",
          path: "/code/gnar-term",
          remote: "git@github.com:TheGnarCo/gnar-term.git",
          active: true,
          workspaces: [],
        },
      ],
    };

    setupInvoke({
      "/Users/test/.config/gnar/state.json": JSON.stringify(saved),
    });

    const state = await loadState();
    expect(state.projects).toHaveLength(1);
    expect(state.projects[0].name).toBe("gnar-term");
  });

  it("handles malformed JSON gracefully", async () => {
    setupInvoke({
      "/Users/test/.config/gnar/state.json": "not json!!!",
    });

    const state = await loadState();
    expect(state).toEqual(DEFAULT_STATE);
  });

  it("handles valid JSON with wrong shape gracefully", async () => {
    setupInvoke({
      "/Users/test/.config/gnar/state.json": JSON.stringify({
        projects: null,
        someUnknownField: true,
      }),
    });

    const state = await loadState();
    expect(Array.isArray(state.projects)).toBe(true);
    expect(state.projects).toHaveLength(0);
  });
});

describe("saveState()", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    _resetForTesting();
  });

  it("writes state to the state file", async () => {
    setupInvoke({});
    await loadState();
    await saveState();

    expect(mockInvoke).toHaveBeenCalledWith("ensure_dir", {
      path: "/Users/test/.config/gnar",
    });
    expect(mockInvoke).toHaveBeenCalledWith(
      "write_file",
      expect.objectContaining({
        path: "/Users/test/.config/gnar/state.json",
      }),
    );
  });

  it("serializes current state including mutations", async () => {
    setupInvoke({});
    await loadState();

    addProject({
      id: "p1",
      name: "test-project",
      path: "/code/test",
      active: true,
      workspaces: [],
    });

    await saveState();

    const writeCall = mockInvoke.mock.calls.find((c) => c[0] === "write_file");
    const written = JSON.parse((writeCall![1] as any).content);
    expect(written.projects).toHaveLength(1);
    expect(written.projects[0].name).toBe("test-project");
  });
});

describe("getState()", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it("returns current state", () => {
    const state = getState();
    expect(state.projects).toBeDefined();
  });
});

describe("addProject()", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it("adds a project to state", () => {
    addProject({
      id: "p1",
      name: "my-project",
      path: "/code/my-project",
      active: true,
      workspaces: [],
    });

    const state = getState();
    expect(state.projects).toHaveLength(1);
    expect(state.projects[0].name).toBe("my-project");
  });

  it("adds multiple projects", () => {
    addProject({
      id: "p1",
      name: "proj-1",
      path: "/a",
      active: true,
      gitBacked: true,
      color: "#e06c75",
      workspaces: [],
    });
    addProject({
      id: "p2",
      name: "proj-2",
      path: "/b",
      active: true,
      gitBacked: true,
      color: "#e06c75",
      workspaces: [],
    });

    expect(getState().projects).toHaveLength(2);
  });

  it("does not add duplicate project ids", () => {
    addProject({
      id: "p1",
      name: "proj-1",
      path: "/a",
      active: true,
      gitBacked: true,
      color: "#e06c75",
      workspaces: [],
    });
    addProject({
      id: "p1",
      name: "proj-1-dup",
      path: "/a",
      active: true,
      gitBacked: true,
      color: "#e06c75",
      workspaces: [],
    });

    expect(getState().projects).toHaveLength(1);
    expect(getState().projects[0].name).toBe("proj-1");
  });
});

describe("removeProject()", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it("removes a project by id", () => {
    addProject({
      id: "p1",
      name: "proj",
      path: "/a",
      active: true,
      gitBacked: true,
      color: "#e06c75",
      workspaces: [],
    });
    expect(getState().projects).toHaveLength(1);

    removeProject("p1");
    expect(getState().projects).toHaveLength(0);
  });

  it("is a no-op for non-existent id", () => {
    addProject({
      id: "p1",
      name: "proj",
      path: "/a",
      active: true,
      gitBacked: true,
      color: "#e06c75",
      workspaces: [],
    });
    removeProject("nonexistent");
    expect(getState().projects).toHaveLength(1);
  });
});

describe("addWorkspace()", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it("adds a workspace to a project", () => {
    addProject({
      id: "p1",
      name: "proj",
      path: "/a",
      active: true,
      gitBacked: true,
      color: "#e06c75",
      workspaces: [],
    });

    addWorkspace("p1", {
      id: "ws_001",
      type: "terminal",
      name: "main",
      status: "active",
    });

    const proj = getState().projects[0];
    expect(proj.workspaces).toHaveLength(1);
    expect(proj.workspaces[0].name).toBe("main");
  });

  it("adds a managed workspace with branch info", () => {
    addProject({
      id: "p1",
      name: "proj",
      path: "/a",
      active: true,
      gitBacked: true,
      color: "#e06c75",
      workspaces: [],
    });

    addWorkspace("p1", {
      id: "ws_002",
      type: "managed",
      name: "Feature X",
      status: "active",
      branch: "jrvs/feat-x",
      baseBranch: "main",
      worktreePath: "/a-worktrees/jrvs/feat-x",
    });

    const ws = getState().projects[0].workspaces[0];
    expect(ws.type).toBe("managed");
    expect(ws.branch).toBe("jrvs/feat-x");
  });

  it("is a no-op for non-existent project", () => {
    addWorkspace("nonexistent", {
      id: "ws_001",
      type: "terminal",
      name: "main",
      status: "active",
    });
    // No crash, no state change
    expect(getState().projects).toHaveLength(0);
  });

  it("does not add duplicate workspace ids", () => {
    addProject({
      id: "p1",
      name: "proj",
      path: "/a",
      active: true,
      gitBacked: true,
      color: "#e06c75",
      workspaces: [],
    });
    addWorkspace("p1", {
      id: "ws_001",
      type: "terminal",
      name: "main",
      status: "active",
    });
    addWorkspace("p1", {
      id: "ws_001",
      type: "terminal",
      name: "dup",
      status: "active",
    });

    expect(getState().projects[0].workspaces).toHaveLength(1);
    expect(getState().projects[0].workspaces[0].name).toBe("main");
  });
});

describe("removeWorkspace()", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it("removes a managed workspace from a project", () => {
    addProject({
      id: "p1",
      name: "proj",
      path: "/a",
      active: true,
      gitBacked: true,
      color: "#e06c75",
      workspaces: [],
    });
    addWorkspace("p1", {
      id: "ws_001",
      type: "managed",
      name: "feature-branch",
      status: "active",
    });
    expect(getState().projects[0].workspaces).toHaveLength(1);

    removeWorkspace("p1", "ws_001");
    expect(getState().projects[0].workspaces).toHaveLength(0);
  });

  it("deletes terminal workspaces from project state", () => {
    addProject({
      id: "p1",
      name: "proj",
      path: "/a",
      active: true,
      gitBacked: true,
      color: "#e06c75",
      workspaces: [],
    });
    addWorkspace("p1", {
      id: "ws_001",
      type: "terminal",
      name: "Terminal",
      status: "active",
    });
    expect(getState().projects[0].workspaces).toHaveLength(1);

    removeWorkspace("p1", "ws_001");
    expect(getState().projects[0].workspaces).toHaveLength(0);
  });

  it("is a no-op for non-existent workspace", () => {
    addProject({
      id: "p1",
      name: "proj",
      path: "/a",
      active: true,
      gitBacked: true,
      color: "#e06c75",
      workspaces: [],
    });
    addWorkspace("p1", {
      id: "ws_001",
      type: "managed",
      name: "feature",
      status: "active",
    });

    removeWorkspace("p1", "nonexistent");
    expect(getState().projects[0].workspaces).toHaveLength(1);
  });
});

describe("updateWorkspaceStatus()", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it("updates workspace status", () => {
    addProject({
      id: "p1",
      name: "proj",
      path: "/a",
      active: true,
      gitBacked: true,
      color: "#e06c75",
      workspaces: [],
    });
    addWorkspace("p1", {
      id: "ws_001",
      type: "managed",
      name: "feat",
      status: "active",
    });

    updateWorkspaceStatus("p1", "ws_001", "stashed");
    expect(getState().projects[0].workspaces[0].status).toBe("stashed");
  });

  it("supports full lifecycle: active -> stashed -> archived", () => {
    addProject({
      id: "p1",
      name: "proj",
      path: "/a",
      active: true,
      gitBacked: true,
      color: "#e06c75",
      workspaces: [],
    });
    addWorkspace("p1", {
      id: "ws_001",
      type: "managed",
      name: "feat",
      status: "active",
    });

    updateWorkspaceStatus("p1", "ws_001", "stashed");
    expect(getState().projects[0].workspaces[0].status).toBe("stashed");

    updateWorkspaceStatus("p1", "ws_001", "archived");
    expect(getState().projects[0].workspaces[0].status).toBe("archived");
  });

  it("is a no-op for non-existent workspace", () => {
    addProject({
      id: "p1",
      name: "proj",
      path: "/a",
      active: true,
      gitBacked: true,
      color: "#e06c75",
      workspaces: [],
    });
    addWorkspace("p1", {
      id: "ws_001",
      type: "terminal",
      name: "main",
      status: "active",
    });

    updateWorkspaceStatus("p1", "nonexistent", "stashed");
    expect(getState().projects[0].workspaces[0].status).toBe("active");
  });
});

describe("round-trip serialization", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    _resetForTesting();
  });

  it("state survives save + reload", async () => {
    let savedContent = "";
    mockInvoke.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "get_home") return "/Users/test";
      if (cmd === "read_file") {
        const path = (args as any)?.path;
        if (path === "/Users/test/.config/gnar/state.json" && savedContent) {
          return savedContent;
        }
        throw new Error("not found");
      }
      if (cmd === "write_file") {
        savedContent = (args as any).content;
        return undefined;
      }
      if (cmd === "ensure_dir") return undefined;
      throw new Error(`Unknown: ${cmd}`);
    });

    // Build up some state
    await loadState();
    addProject({
      id: "p1",
      name: "gnar-term",
      path: "/code/gnar-term",
      remote: "git@github.com:TheGnarCo/gnar-term.git",
      active: true,
      workspaces: [],
    });
    addWorkspace("p1", {
      id: "ws_001",
      type: "managed",
      name: "Feature X",
      status: "active",
      branch: "jrvs/feat-x",
      baseBranch: "main",
      worktreePath: "/code/gnar-term-worktrees/jrvs/feat-x",
    });

    // Save
    await saveState();

    // Reset and reload
    _resetForTesting();
    const reloaded = await loadState();

    expect(reloaded.projects).toHaveLength(1);
    expect(reloaded.projects[0].name).toBe("gnar-term");
    expect(reloaded.projects[0].workspaces).toHaveLength(1);
    expect(reloaded.projects[0].workspaces[0].branch).toBe("jrvs/feat-x");
  });
});
