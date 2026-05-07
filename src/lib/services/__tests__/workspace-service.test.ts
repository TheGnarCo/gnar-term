/**
 * Unit tests for the core Workspace service — CRUD, membership,
 * and dashboard-close behavior. Persistence is mocked out via the
 * in-memory svelte store.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";
import {
  addWorkspace,
  addBranchToWorkspace,
  closeWorkspacesInWorkspace,
  deleteWorkspace,
  getWorkspace,
  getWorkspaces,
  removeBranchFromAllWorkspaces,
  updateWorkspace,
  WORKSPACE_STATE_CHANGED,
} from "../workspace-service";
import {
  resetWorkspacesForTest,
  workspacesStore,
} from "../../stores/workspace";
import { eventBus } from "../event-bus";
import { rootRowOrder } from "../../stores/root-row-order";
import { workspaces, activeWorkspaceIdx } from "../../stores/workspace";
import type { Workspace } from "../../types";
import type { WorkspaceRecord } from "../../config";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

function makeWorkspace(
  id: string,
  overrides: Partial<WorkspaceRecord> = {},
): WorkspaceRecord {
  return {
    id,
    name: `Workspace ${id}`,
    path: `/tmp/${id}`,
    color: "slot-1",
    branchedWorkspaceIds: [],
    isGit: false,
    createdAt: "2026-04-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("workspace-service", () => {
  beforeEach(() => {
    resetWorkspacesForTest();
    rootRowOrder.set([]);
  });

  it("addWorkspace persists the workspace and appends a root row", () => {
    const workspace = makeWorkspace("g1");
    addWorkspace(workspace);

    expect(getWorkspaces()).toHaveLength(1);
    expect(get(workspacesStore)[0].id).toBe("g1");
    expect(get(rootRowOrder)).toContainEqual({
      kind: "workspace",
      id: "g1",
    });
  });

  it("updateWorkspace patches an existing workspace in place", () => {
    addWorkspace(makeWorkspace("g1"));
    updateWorkspace("g1", { name: "Renamed" });
    expect(getWorkspace("g1")?.name).toBe("Renamed");
  });

  it("deleteWorkspace removes the record and its root row", () => {
    addWorkspace(makeWorkspace("g1"));
    deleteWorkspace("g1");
    expect(getWorkspaces()).toHaveLength(0);
    expect(get(rootRowOrder)).not.toContainEqual({
      kind: "workspace",
      id: "g1",
    });
  });

  it("addBranchToWorkspace is idempotent", () => {
    addWorkspace(makeWorkspace("g1"));
    expect(addBranchToWorkspace("g1", "ws1")).toBe(true);
    expect(addBranchToWorkspace("g1", "ws1")).toBe(false);
    expect(getWorkspace("g1")?.branchedWorkspaceIds).toEqual(["ws1"]);
  });

  it("removeBranchFromAllWorkspaces strips the id across every workspace", () => {
    addWorkspace(makeWorkspace("g1"));
    addWorkspace(makeWorkspace("g2"));
    addBranchToWorkspace("g1", "ws1");
    addBranchToWorkspace("g2", "ws1");

    removeBranchFromAllWorkspaces("ws1");

    expect(getWorkspace("g1")?.branchedWorkspaceIds).toEqual([]);
    expect(getWorkspace("g2")?.branchedWorkspaceIds).toEqual([]);
  });

  describe("closeWorkspacesInWorkspace", () => {
    function makeWs(id: string, rootWorkspaceId?: string): Workspace {
      return {
        id,
        name: id,
        paneLayout: {
          type: "pane",
          pane: { id: `${id}-p`, surfaces: [], activeSurfaceId: null },
        },
        activePaneId: `${id}-p`,
        ...(rootWorkspaceId ? { rootWorkspaceId } : {}),
      } as Workspace;
    }

    beforeEach(() => {
      workspaces.set([]);
      activeWorkspaceIdx.set(-1);
    });

    it("closes every child workspace tagged with the workspace id", () => {
      workspaces.set([
        makeWs("ws-a", "g1"),
        makeWs("ws-b", "g1"),
        makeWs("ws-other", "g2"),
        makeWs("ws-root"),
      ]);

      closeWorkspacesInWorkspace("g1");

      const remainingIds = get(workspaces).map((w) => w.id);
      expect(remainingIds).toEqual(["ws-other", "ws-root"]);
    });

    it("is a no-op when no workspaces belong to the workspace", () => {
      workspaces.set([makeWs("ws-root"), makeWs("ws-other", "g2")]);
      closeWorkspacesInWorkspace("g1");
      expect(get(workspaces).map((w) => w.id)).toEqual(["ws-root", "ws-other"]);
    });

    it("also closes the workspace's Dashboard child workspace (same rootWorkspaceId metadata)", () => {
      const dashboard = {
        ...makeWs("ws-dashboard", "g1"),
        isDashboard: true,
      } as Workspace;
      workspaces.set([dashboard, makeWs("ws-child", "g1")]);

      closeWorkspacesInWorkspace("g1");

      expect(get(workspaces)).toHaveLength(0);
    });
  });

  it("emits WORKSPACE_STATE_CHANGED on mutations", () => {
    const listener = vi.fn();
    eventBus.on(WORKSPACE_STATE_CHANGED, listener);
    addWorkspace(makeWorkspace("g1"));
    updateWorkspace("g1", { name: "Renamed" });
    deleteWorkspace("g1");
    eventBus.off(WORKSPACE_STATE_CHANGED, listener);

    // add + update + delete = 3 events
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
