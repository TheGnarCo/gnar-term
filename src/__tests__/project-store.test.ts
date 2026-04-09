/**
 * Tests for the project Svelte store — reactive project management
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";
import {
  projects,
  activeProjects,
  inactiveProjects,
  initProjects,
  registerProject,
  unregisterProject,
  setProjectActive,
} from "../lib/stores/project";

// Mock state.ts
vi.mock("../lib/state", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/state")>("../lib/state");
  return {
    getState: vi.fn(() => ({ projects: [] })),
    addProject: vi.fn(),
    removeProject: vi.fn(),
    saveState: vi.fn(() => Promise.resolve()),
    updateProjectActive: vi.fn(() => Promise.resolve()),
    updateProjectColor: vi.fn(() => Promise.resolve()),
    nextProjectColor: actual.nextProjectColor,
  };
});

// Mock Tauri invoke for git operations
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.reject("not found")),
}));

import {
  getState,
  addProject,
  removeProject,
  saveState,
  updateProjectActive,
  updateProjectColor,
} from "../lib/state";
const mockGetState = vi.mocked(getState);
const mockAddProject = vi.mocked(addProject);
const mockRemoveProject = vi.mocked(removeProject);
const mockSaveState = vi.mocked(saveState);
const mockUpdateProjectActive = vi.mocked(updateProjectActive);
const mockUpdateProjectColor = vi.mocked(updateProjectColor);

describe("projects store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projects.set([]);
  });

  it("starts empty", () => {
    expect(get(projects)).toEqual([]);
  });

  it("derives activeProjects from projects", () => {
    projects.set([
      {
        id: "p1",
        name: "active",
        path: "/a",
        active: true,
        gitBacked: true,
        color: "#e06c75",
        workspaces: [],
      },
      {
        id: "p2",
        name: "inactive",
        path: "/b",
        active: false,
        gitBacked: false,
        color: "#61afef",
        workspaces: [],
      },
    ]);
    expect(get(activeProjects)).toHaveLength(1);
    expect(get(activeProjects)[0].name).toBe("active");
  });

  it("derives inactiveProjects from projects", () => {
    projects.set([
      {
        id: "p1",
        name: "active",
        path: "/a",
        active: true,
        gitBacked: true,
        color: "#e06c75",
        workspaces: [],
      },
      {
        id: "p2",
        name: "inactive",
        path: "/b",
        active: false,
        gitBacked: false,
        color: "#61afef",
        workspaces: [],
      },
    ]);
    expect(get(inactiveProjects)).toHaveLength(1);
    expect(get(inactiveProjects)[0].name).toBe("inactive");
  });
});

describe("initProjects()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projects.set([]);
  });

  it("loads projects from state", () => {
    mockGetState.mockReturnValue({
      projects: [
        {
          id: "p1",
          name: "proj",
          path: "/code/proj",
          active: true,
          gitBacked: true,
          color: "#e06c75",
          workspaces: [],
        },
      ],
    });

    initProjects();
    expect(get(projects)).toHaveLength(1);
    expect(get(projects)[0].name).toBe("proj");
  });
});

describe("registerProject()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projects.set([]);
  });

  it("adds project to store and state", async () => {
    await registerProject("/code/my-project", "my-project");

    expect(mockAddProject).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "my-project",
        path: "/code/my-project",
        active: true,
      }),
    );
    expect(mockSaveState).toHaveBeenCalled();
    expect(get(projects)).toHaveLength(1);
    expect(get(projects)[0].name).toBe("my-project");
  });

  it("generates unique ids", async () => {
    await registerProject("/code/a", "proj-a");
    await registerProject("/code/b", "proj-b");

    const ids = get(projects).map((p) => p.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("detects git remote when available", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (
        cmd === "read_file" &&
        (args as any)?.path?.endsWith("/.git/config")
      ) {
        return '[remote "origin"]\n\turl = git@github.com:TheGnarCo/gnar-term.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n';
      }
      throw new Error("not found");
    });

    await registerProject("/code/gnar-term", "gnar-term");

    const proj = get(projects)[0];
    expect(proj.remote).toBe("git@github.com:TheGnarCo/gnar-term.git");
  });
});

describe("unregisterProject()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projects.set([
      {
        id: "p1",
        name: "proj",
        path: "/a",
        active: true,
        gitBacked: true,
        color: "#e06c75",
        workspaces: [],
      },
    ]);
  });

  it("removes project from store and state", async () => {
    await unregisterProject("p1");

    expect(mockRemoveProject).toHaveBeenCalledWith("p1");
    expect(mockSaveState).toHaveBeenCalled();
    expect(get(projects)).toHaveLength(0);
  });

  it("is a no-op for non-existent id", async () => {
    await unregisterProject("nonexistent");
    expect(get(projects)).toHaveLength(1);
  });
});

describe("setProjectActive()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projects.set([
      {
        id: "p1",
        name: "proj",
        path: "/a",
        active: true,
        gitBacked: true,
        color: "#e06c75",
        workspaces: [],
      },
    ]);
  });

  it("sets project inactive", async () => {
    // After updateProjectActive, getState should return the updated project
    mockGetState.mockReturnValue({
      projects: [
        {
          id: "p1",
          name: "proj",
          path: "/a",
          active: false,
          gitBacked: true,
          color: "#e06c75",
          workspaces: [],
        },
      ],
      floatingWorkspaces: [],
    });

    await setProjectActive("p1", false);

    expect(mockUpdateProjectActive).toHaveBeenCalledWith("p1", false);
    expect(get(projects)[0].active).toBe(false);
  });

  it("sets project active", async () => {
    projects.set([
      {
        id: "p1",
        name: "proj",
        path: "/a",
        active: false,
        gitBacked: false,
        color: "#61afef",
        workspaces: [],
      },
    ]);

    // After updateProjectActive, getState should return the updated project
    mockGetState.mockReturnValue({
      projects: [
        {
          id: "p1",
          name: "proj",
          path: "/a",
          active: true,
          gitBacked: false,
          color: "#61afef",
          workspaces: [],
        },
      ],
      floatingWorkspaces: [],
    });

    await setProjectActive("p1", true);

    expect(mockUpdateProjectActive).toHaveBeenCalledWith("p1", true);
    expect(get(projects)[0].active).toBe(true);
  });
});
