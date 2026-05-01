/**
 * Unit tests for the core Workspace service — CRUD, membership,
 * and dashboard-close behavior. Persistence is mocked out via the
 * in-memory svelte store.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";
import {
  addWorkspaceGroup,
  addWorkspaceToGroup,
  closeWorkspacesInGroup,
  deleteWorkspaceGroup,
  getWorkspaceGroup,
  getWorkspaceGroups,
  removeWorkspaceFromAllGroups,
  updateWorkspaceGroup,
  WORKSPACE_GROUP_STATE_CHANGED,
} from "../workspace-group-service";
import {
  resetWorkspaceGroupsForTest,
  workspaceGroupsStore,
} from "../../stores/workspace-groups";
import { eventBus } from "../event-bus";
import { rootRowOrder } from "../../stores/root-row-order";
import { workspaces, activeWorkspaceIdx } from "../../stores/workspace";
import type { NestedWorkspace } from "../../types";
import type { WorkspaceEntry } from "../../config";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

function makeGroup(
  id: string,
  overrides: Partial<WorkspaceEntry> = {},
): WorkspaceEntry {
  return {
    id,
    name: `Group ${id}`,
    path: `/tmp/${id}`,
    color: "slot-1",
    workspaceIds: [],
    isGit: false,
    createdAt: "2026-04-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("workspace-group-service", () => {
  beforeEach(() => {
    resetWorkspaceGroupsForTest();
    rootRowOrder.set([]);
  });

  it("addWorkspaceGroup persists the group and appends a root row", () => {
    const group = makeGroup("g1");
    addWorkspaceGroup(group);

    expect(getWorkspaceGroups()).toHaveLength(1);
    expect(get(workspaceGroupsStore)[0].id).toBe("g1");
    expect(get(rootRowOrder)).toContainEqual({
      kind: "workspace-group",
      id: "g1",
    });
  });

  it("updateWorkspaceGroup patches an existing group in place", () => {
    addWorkspaceGroup(makeGroup("g1"));
    updateWorkspaceGroup("g1", { name: "Renamed" });
    expect(getWorkspaceGroup("g1")?.name).toBe("Renamed");
  });

  it("deleteWorkspaceGroup removes the record and its root row", () => {
    addWorkspaceGroup(makeGroup("g1"));
    deleteWorkspaceGroup("g1");
    expect(getWorkspaceGroups()).toHaveLength(0);
    expect(get(rootRowOrder)).not.toContainEqual({
      kind: "workspace-group",
      id: "g1",
    });
  });

  it("addWorkspaceToGroup is idempotent", () => {
    addWorkspaceGroup(makeGroup("g1"));
    expect(addWorkspaceToGroup("g1", "ws1")).toBe(true);
    expect(addWorkspaceToGroup("g1", "ws1")).toBe(false);
    expect(getWorkspaceGroup("g1")?.workspaceIds).toEqual(["ws1"]);
  });

  it("removeWorkspaceFromAllGroups strips the id across every group", () => {
    addWorkspaceGroup(makeGroup("g1"));
    addWorkspaceGroup(makeGroup("g2"));
    addWorkspaceToGroup("g1", "ws1");
    addWorkspaceToGroup("g2", "ws1");

    removeWorkspaceFromAllGroups("ws1");

    expect(getWorkspaceGroup("g1")?.workspaceIds).toEqual([]);
    expect(getWorkspaceGroup("g2")?.workspaceIds).toEqual([]);
  });

  describe("closeWorkspacesInGroup", () => {
    function makeWs(id: string, groupId?: string): NestedWorkspace {
      return {
        id,
        name: id,
        splitRoot: {
          type: "pane",
          pane: { id: `${id}-p`, surfaces: [], activeSurfaceId: null },
        },
        activePaneId: `${id}-p`,
        ...(groupId ? { metadata: { groupId } } : {}),
      } as NestedWorkspace;
    }

    beforeEach(() => {
      workspaces.set([]);
      activeWorkspaceIdx.set(-1);
    });

    it("closes every workspace tagged with the group id", () => {
      workspaces.set([
        makeWs("ws-a", "g1"),
        makeWs("ws-b", "g1"),
        makeWs("ws-other", "g2"),
        makeWs("ws-root"),
      ]);

      closeWorkspacesInGroup("g1");

      const remainingIds = get(workspaces).map((w) => w.id);
      expect(remainingIds).toEqual(["ws-other", "ws-root"]);
    });

    it("is a no-op when no workspaces belong to the group", () => {
      workspaces.set([makeWs("ws-root"), makeWs("ws-other", "g2")]);
      closeWorkspacesInGroup("g1");
      expect(get(workspaces).map((w) => w.id)).toEqual(["ws-root", "ws-other"]);
    });

    it("also closes the group's Dashboard workspace (same groupId metadata)", () => {
      const dashboard = {
        ...makeWs("ws-dashboard", "g1"),
        metadata: { groupId: "g1", isDashboard: true },
      } as NestedWorkspace;
      workspaces.set([dashboard, makeWs("ws-nested", "g1")]);

      closeWorkspacesInGroup("g1");

      expect(get(workspaces)).toHaveLength(0);
    });
  });

  it("emits WORKSPACE_GROUP_STATE_CHANGED on mutations", () => {
    const listener = vi.fn();
    eventBus.on(WORKSPACE_GROUP_STATE_CHANGED, listener);
    addWorkspaceGroup(makeGroup("g1"));
    updateWorkspaceGroup("g1", { name: "Renamed" });
    deleteWorkspaceGroup("g1");
    eventBus.off(WORKSPACE_GROUP_STATE_CHANGED, listener);

    // add + update + delete = 3 events
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
