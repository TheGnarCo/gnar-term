/**
 * Unit tests for the core Workspace service — CRUD, membership,
 * and dashboard-close behavior. Persistence is mocked out via the
 * in-memory svelte store.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";
import {
  addWorkspace,
  addNestedWorkspaceToWorkspace,
  closeNestedWorkspacesInWorkspace,
  deleteWorkspace,
  getWorkspace,
  getWorkspaces,
  removeNestedWorkspaceFromAllWorkspaces,
  updateWorkspace,
  WORKSPACE_GROUP_STATE_CHANGED,
} from "../workspace-service";
import {
  resetWorkspacesForTest,
  workspacesStore,
} from "../../stores/workspaces";
import { eventBus } from "../event-bus";
import { rootRowOrder } from "../../stores/root-row-order";
import {
  nestedWorkspaces,
  activeNestedWorkspaceIdx,
} from "../../stores/nested-workspace";
import type { NestedWorkspace } from "../../types";
import type { Workspace } from "../../config";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

function makeWorkspace(
  id: string,
  overrides: Partial<Workspace> = {},
): Workspace {
  return {
    id,
    name: `Group ${id}`,
    path: `/tmp/${id}`,
    color: "slot-1",
    nestedWorkspaceIds: [],
    isGit: false,
    createdAt: "2026-04-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("workspace-group-service", () => {
  beforeEach(() => {
    resetWorkspacesForTest();
    rootRowOrder.set([]);
  });

  it("addWorkspace persists the group and appends a root row", () => {
    const group = makeWorkspace("g1");
    addWorkspace(group);

    expect(getWorkspaces()).toHaveLength(1);
    expect(get(workspacesStore)[0].id).toBe("g1");
    expect(get(rootRowOrder)).toContainEqual({
      kind: "workspace-group",
      id: "g1",
    });
  });

  it("updateWorkspace patches an existing group in place", () => {
    addWorkspace(makeWorkspace("g1"));
    updateWorkspace("g1", { name: "Renamed" });
    expect(getWorkspace("g1")?.name).toBe("Renamed");
  });

  it("deleteWorkspace removes the record and its root row", () => {
    addWorkspace(makeWorkspace("g1"));
    deleteWorkspace("g1");
    expect(getWorkspaces()).toHaveLength(0);
    expect(get(rootRowOrder)).not.toContainEqual({
      kind: "workspace-group",
      id: "g1",
    });
  });

  it("addNestedWorkspaceToWorkspace is idempotent", () => {
    addWorkspace(makeWorkspace("g1"));
    expect(addNestedWorkspaceToWorkspace("g1", "ws1")).toBe(true);
    expect(addNestedWorkspaceToWorkspace("g1", "ws1")).toBe(false);
    expect(getWorkspace("g1")?.nestedWorkspaceIds).toEqual(["ws1"]);
  });

  it("removeNestedWorkspaceFromAllWorkspaces strips the id across every group", () => {
    addWorkspace(makeWorkspace("g1"));
    addWorkspace(makeWorkspace("g2"));
    addNestedWorkspaceToWorkspace("g1", "ws1");
    addNestedWorkspaceToWorkspace("g2", "ws1");

    removeNestedWorkspaceFromAllWorkspaces("ws1");

    expect(getWorkspace("g1")?.nestedWorkspaceIds).toEqual([]);
    expect(getWorkspace("g2")?.nestedWorkspaceIds).toEqual([]);
  });

  describe("closeNestedWorkspacesInWorkspace", () => {
    function makeWs(id: string, parentWorkspaceId?: string): NestedWorkspace {
      return {
        id,
        name: id,
        splitRoot: {
          type: "pane",
          pane: { id: `${id}-p`, surfaces: [], activeSurfaceId: null },
        },
        activePaneId: `${id}-p`,
        ...(parentWorkspaceId ? { metadata: { parentWorkspaceId } } : {}),
      } as NestedWorkspace;
    }

    beforeEach(() => {
      nestedWorkspaces.set([]);
      activeNestedWorkspaceIdx.set(-1);
    });

    it("closes every workspace tagged with the group id", () => {
      nestedWorkspaces.set([
        makeWs("ws-a", "g1"),
        makeWs("ws-b", "g1"),
        makeWs("ws-other", "g2"),
        makeWs("ws-root"),
      ]);

      closeNestedWorkspacesInWorkspace("g1");

      const remainingIds = get(nestedWorkspaces).map((w) => w.id);
      expect(remainingIds).toEqual(["ws-other", "ws-root"]);
    });

    it("is a no-op when no nestedWorkspaces belong to the group", () => {
      nestedWorkspaces.set([makeWs("ws-root"), makeWs("ws-other", "g2")]);
      closeNestedWorkspacesInWorkspace("g1");
      expect(get(nestedWorkspaces).map((w) => w.id)).toEqual([
        "ws-root",
        "ws-other",
      ]);
    });

    it("also closes the group's Dashboard workspace (same parentWorkspaceId metadata)", () => {
      const dashboard = {
        ...makeWs("ws-dashboard", "g1"),
        metadata: { parentWorkspaceId: "g1", isDashboard: true },
      } as NestedWorkspace;
      nestedWorkspaces.set([dashboard, makeWs("ws-nested", "g1")]);

      closeNestedWorkspacesInWorkspace("g1");

      expect(get(nestedWorkspaces)).toHaveLength(0);
    });
  });

  it("emits WORKSPACE_GROUP_STATE_CHANGED on mutations", () => {
    const listener = vi.fn();
    eventBus.on(WORKSPACE_GROUP_STATE_CHANGED, listener);
    addWorkspace(makeWorkspace("g1"));
    updateWorkspace("g1", { name: "Renamed" });
    deleteWorkspace("g1");
    eventBus.off(WORKSPACE_GROUP_STATE_CHANGED, listener);

    // add + update + delete = 3 events
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
