/**
 * Tests for workspace lifecycle functions (stash, restore, archive, delete).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";
import type { WorkspaceRecord } from "../lib/types";
import type { ProjectState } from "../lib/state";

let mockProjects: ProjectState[] = [];

vi.mock("../lib/state", () => ({
  getState: vi.fn(() => ({ projects: mockProjects })),
  updateWorkspaceStatus: vi.fn(
    (projectId: string, workspaceId: string, status: string) => {
      const project = mockProjects.find((p) => p.id === projectId);
      if (!project) return;
      const ws = project.workspaces.find((w) => w.id === workspaceId);
      if (ws) (ws as any).status = status;
    },
  ),
  removeWorkspace: vi.fn((projectId: string, workspaceId: string) => {
    const project = mockProjects.find((p) => p.id === projectId);
    if (!project) return;
    project.workspaces = project.workspaces.filter((w) => w.id !== workspaceId);
  }),
  addProject: vi.fn(),
  removeProject: vi.fn(),
  saveState: vi.fn(() => Promise.resolve()),
  loadState: vi.fn(() => Promise.resolve()),
}));

vi.mock("../lib/git", () => ({
  removeWorktree: vi.fn(async () => {}),
  pushBranch: vi.fn(async () => {}),
}));

vi.mock("../lib/stores/ui", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/stores/ui")>(
      "../lib/stores/ui",
    );
  return { ...actual, showInputPrompt: vi.fn(async () => "yes") };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.reject("not found")),
}));

vi.mock("../lib/stores/dialog-service", async () => {
  const actual = await vi.importActual<
    typeof import("../lib/stores/dialog-service")
  >("../lib/stores/dialog-service");
  return { ...actual, showConfirmDialog: vi.fn(async () => true) };
});

import {
  projects as projectStore,
  stashWorkspace,
  restoreWorkspace,
  archiveWorkspace,
  deleteWorkspace,
} from "../lib/stores/project";
import {
  updateWorkspaceStatus,
  removeWorkspace as stateRemoveWorkspace,
  saveState,
} from "../lib/state";
import { removeWorktree, pushBranch } from "../lib/git";
import { showConfirmDialog } from "../lib/stores/dialog-service";

function makeWorkspaceRecord(
  overrides: Partial<WorkspaceRecord> = {},
): WorkspaceRecord {
  return {
    id: "ws-1",
    type: "managed",
    name: "Feature Branch",
    status: "active",
    branch: "feature/test",
    baseBranch: "main",
    worktreePath: "/tmp/worktrees/feature-test",
    ...overrides,
  };
}

function seedProject(
  workspaces: WorkspaceRecord[] = [makeWorkspaceRecord()],
): void {
  const project: ProjectState = {
    id: "proj-1",
    name: "Test Project",
    path: "/code/test",
    active: true,
    gitBacked: true,
    color: "#e06c75",
    workspaces,
  };
  mockProjects = [project];
  projectStore.set([project]);
}

describe("Workspace Lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjects = [];
    projectStore.set([]);
  });

  describe("stashWorkspace", () => {
    it("updates workspace status to stashed", async () => {
      seedProject();
      await stashWorkspace("proj-1", "ws-1");
      expect(updateWorkspaceStatus).toHaveBeenCalledWith(
        "proj-1",
        "ws-1",
        "stashed",
      );
    });

    it("calls saveState after updating status", async () => {
      seedProject();
      await stashWorkspace("proj-1", "ws-1");
      expect(saveState).toHaveBeenCalled();
    });
  });

  describe("restoreWorkspace", () => {
    it("updates workspace status to active", async () => {
      seedProject([makeWorkspaceRecord({ status: "stashed" })]);
      await restoreWorkspace("proj-1", "ws-1");
      expect(updateWorkspaceStatus).toHaveBeenCalledWith(
        "proj-1",
        "ws-1",
        "active",
      );
    });
  });

  describe("archiveWorkspace", () => {
    it("prompts user to push branch first", async () => {
      seedProject();
      await archiveWorkspace("proj-1", "ws-1", "/repo");
      expect(showConfirmDialog).toHaveBeenCalledWith(
        expect.stringContaining("Push branch"),
        expect.objectContaining({ title: "Archive Workspace" }),
      );
    });

    it("pushes branch when user confirms", async () => {
      seedProject();
      vi.mocked(showConfirmDialog).mockResolvedValueOnce(true);
      await archiveWorkspace("proj-1", "ws-1", "/repo");
      expect(pushBranch).toHaveBeenCalledWith("/repo", "feature/test");
    });

    it("skips push when user declines", async () => {
      seedProject();
      vi.mocked(showConfirmDialog).mockResolvedValueOnce(false);
      await archiveWorkspace("proj-1", "ws-1", "/repo");
      expect(pushBranch).not.toHaveBeenCalled();
    });

    it("removes the worktree", async () => {
      seedProject();
      await archiveWorkspace("proj-1", "ws-1", "/repo");
      expect(removeWorktree).toHaveBeenCalledWith(
        "/repo",
        "/tmp/worktrees/feature-test",
      );
    });

    it("updates status to archived", async () => {
      seedProject();
      await archiveWorkspace("proj-1", "ws-1", "/repo");
      expect(updateWorkspaceStatus).toHaveBeenCalledWith(
        "proj-1",
        "ws-1",
        "archived",
      );
    });

    it("calls saveState", async () => {
      seedProject();
      await archiveWorkspace("proj-1", "ws-1", "/repo");
      expect(saveState).toHaveBeenCalled();
    });

    it("skips push prompt for workspaces without a branch", async () => {
      seedProject([makeWorkspaceRecord({ branch: undefined })]);
      await archiveWorkspace("proj-1", "ws-1", "/repo");
      expect(showConfirmDialog).not.toHaveBeenCalled();
    });

    it("skips removeWorktree for workspaces without worktreePath", async () => {
      seedProject([makeWorkspaceRecord({ worktreePath: undefined })]);
      await archiveWorkspace("proj-1", "ws-1", "/repo");
      expect(removeWorktree).not.toHaveBeenCalled();
    });

    it("does nothing if workspace not found", async () => {
      seedProject();
      await archiveWorkspace("proj-1", "nonexistent", "/repo");
      expect(showConfirmDialog).not.toHaveBeenCalled();
    });
  });

  describe("deleteWorkspace", () => {
    it("removes workspace from state entirely", async () => {
      seedProject();
      await deleteWorkspace("proj-1", "ws-1");
      expect(stateRemoveWorkspace).toHaveBeenCalledWith("proj-1", "ws-1");
    });

    it("calls saveState", async () => {
      seedProject();
      await deleteWorkspace("proj-1", "ws-1");
      expect(saveState).toHaveBeenCalled();
    });
  });
});
