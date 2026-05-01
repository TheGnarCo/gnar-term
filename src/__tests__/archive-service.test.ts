import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

const mocks = vi.hoisted(() => ({
  closeNestedWorkspace: vi.fn(),
  createNestedWorkspaceFromDef: vi.fn(() => Promise.resolve("new-ws-id")),
  serializeLayout: vi.fn(() => ({ pane: { surfaces: [] } })),
  schedulePersist: vi.fn(),
  showConfirmPrompt: vi.fn(() => Promise.resolve(true)),
  getWorkspace: vi.fn(() => undefined as unknown),
  getWorkspaces: vi.fn(() => [] as unknown[]),
  setWorkspaces: vi.fn(),
  getWorktreeWorkspaces: vi.fn(() => [] as unknown[]),
  closeNestedWorkspacesInWorkspace: vi.fn(),
  provisionAutoDashboardsForWorkspace: vi.fn(() => Promise.resolve()),
  removeRootRow: vi.fn(),
  appendRootRow: vi.fn(),
}));

vi.mock("../lib/config", () => ({
  saveState: vi.fn(() => Promise.resolve()),
  getState: vi.fn(() => ({
    archivedOrder: [],
    archivedDefs: { workspaces: {} },
  })),
}));

vi.mock("../lib/stores/nested-workspace", async () => {
  const { writable } = await import("svelte/store");
  return {
    nestedWorkspaces: writable([]),
    activeNestedWorkspaceIdx: writable(0),
    activeWorkspace: writable(null),
    activeSurface: writable(null),
    activePseudoWorkspaceId: writable(null),
    zoomedSurfaceId: writable(null),
  };
});

vi.mock("../lib/services/nested-workspace-service", () => ({
  closeNestedWorkspace: mocks.closeNestedWorkspace,
  createNestedWorkspaceFromDef: mocks.createNestedWorkspaceFromDef,
  serializeLayout: mocks.serializeLayout,
  schedulePersist: mocks.schedulePersist,
}));

vi.mock("../lib/stores/workspaces", () => ({
  getWorkspace: mocks.getWorkspace,
  getWorkspaces: mocks.getWorkspaces,
  setWorkspaces: mocks.setWorkspaces,
}));

vi.mock("../lib/services/workspace-service", () => ({
  getWorktreeWorkspaces: mocks.getWorktreeWorkspaces,
  closeNestedWorkspacesInWorkspace: mocks.closeNestedWorkspacesInWorkspace,
  provisionAutoDashboardsForWorkspace:
    mocks.provisionAutoDashboardsForWorkspace,
}));

vi.mock("../lib/stores/root-row-order", () => ({
  removeRootRow: mocks.removeRootRow,
  appendRootRow: mocks.appendRootRow,
}));

vi.mock("../lib/stores/ui", () => ({
  showConfirmPrompt: mocks.showConfirmPrompt,
}));

import { nestedWorkspaces } from "../lib/stores/nested-workspace";
import {
  initArchiveFromState,
  archivedOrder,
  archivedDefs,
  addToArchive,
} from "../lib/stores/archive";
import {
  archiveWorkspace,
  unarchiveWorkspace,
} from "../lib/services/archive-service";

beforeEach(() => {
  vi.clearAllMocks();
  initArchiveFromState();
  nestedWorkspaces.set([]);
  mocks.showConfirmPrompt.mockImplementation(() => Promise.resolve(true));
  mocks.createNestedWorkspaceFromDef.mockImplementation(() =>
    Promise.resolve("new-ws-id"),
  );
  mocks.getWorkspace.mockReturnValue(undefined);
  mocks.getWorkspaces.mockReturnValue([]);
  mocks.getWorktreeWorkspaces.mockReturnValue([]);
  mocks.provisionAutoDashboardsForWorkspace.mockImplementation(() =>
    Promise.resolve(),
  );
});

function makeWorkspace(overrides = {}) {
  return {
    id: "g-1",
    name: "My Group",
    path: "/foo",
    color: "blue",
    nestedWorkspaceIds: ["ws-1", "ws-2", "ws-dash"],
    isGit: false,
    createdAt: "2026-01-01",
    ...overrides,
  };
}

function makeRunningTerminalWs(id: string, name: string, ptyId: number) {
  return {
    id,
    name,
    splitRoot: {
      type: "pane" as const,
      pane: {
        id: `${id}-p1`,
        activeSurfaceId: `${id}-s1`,
        surfaces: [
          {
            kind: "terminal",
            id: `${id}-s1`,
            title: "bash",
            ptyId,
            hasUnread: false,
            cwd: "/",
            terminal: {},
            pendingData: [],
          },
        ],
      },
    },
    activePaneId: `${id}-p1`,
  };
}

describe("archiveWorkspace", () => {
  it("returns false when the group is not found", async () => {
    mocks.getWorkspace.mockReturnValueOnce(undefined);
    const result = await archiveWorkspace("g-missing");
    expect(result).toBe(false);
    expect(mocks.closeNestedWorkspacesInWorkspace).not.toHaveBeenCalled();
    expect(mocks.setWorkspaces).not.toHaveBeenCalled();
  });

  it("skips dashboard nestedWorkspaces when counting running PTYs", async () => {
    const group = makeWorkspace();
    const dashboardWs = {
      ...makeRunningTerminalWs("ws-dash", "Dashboard", 99),
      metadata: { isDashboard: true },
    };
    mocks.getWorkspace.mockReturnValueOnce(group);
    mocks.getWorkspaces.mockReturnValue([group]);
    // Only the dashboard has a running PTY — counting it would prompt;
    // skipping it should not.
    mocks.getWorktreeWorkspaces.mockReturnValueOnce([dashboardWs]);

    const result = await archiveWorkspace("g-1");

    expect(mocks.showConfirmPrompt).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("closes nestedWorkspaces, removes group, removes root row, and adds to archive", async () => {
    const group = makeWorkspace();
    const ws1 = makeRunningTerminalWs("ws-1", "W1", -1);
    const ws2 = makeRunningTerminalWs("ws-2", "W2", -1);
    mocks.getWorkspace.mockReturnValueOnce(group);
    mocks.getWorkspaces.mockReturnValue([group, { id: "other" }]);
    mocks.getWorktreeWorkspaces.mockReturnValueOnce([ws1, ws2]);

    const result = await archiveWorkspace("g-1");

    expect(result).toBe(true);
    expect(mocks.closeNestedWorkspacesInWorkspace).toHaveBeenCalledWith("g-1");
    expect(mocks.setWorkspaces).toHaveBeenCalledWith([{ id: "other" }]);
    expect(mocks.removeRootRow).toHaveBeenCalledWith({
      kind: "workspace",
      id: "g-1",
    });
    expect(get(archivedOrder)).toEqual(["g-1"]);
    const stored = get(archivedDefs).workspaces["g-1"];
    expect(stored?.workspace).toEqual(group);
    expect(stored?.nestedWorkspaceDefs).toHaveLength(2);
    expect(stored?.nestedWorkspaceDefs[0]?.name).toBe("W1");
    expect(stored?.nestedWorkspaceDefs[1]?.name).toBe("W2");
  });

  it("returns false when the user cancels the confirm prompt", async () => {
    const group = makeWorkspace();
    const wsRunning = makeRunningTerminalWs("ws-1", "W1", 42);
    mocks.getWorkspace.mockReturnValueOnce(group);
    mocks.getWorktreeWorkspaces.mockReturnValueOnce([wsRunning]);
    mocks.showConfirmPrompt.mockResolvedValueOnce(false);

    const result = await archiveWorkspace("g-1");

    expect(result).toBe(false);
    expect(mocks.closeNestedWorkspacesInWorkspace).not.toHaveBeenCalled();
    expect(mocks.setWorkspaces).not.toHaveBeenCalled();
    expect(get(archivedOrder)).toHaveLength(0);
  });

  it("serializes only non-dashboard nestedWorkspaces into the archived defs", async () => {
    const group = makeWorkspace();
    const ws1 = makeRunningTerminalWs("ws-1", "Real", -1);
    const dashboardWs = {
      ...makeRunningTerminalWs("ws-dash", "Dashboard", -1),
      metadata: { isDashboard: true },
    };
    mocks.getWorkspace.mockReturnValueOnce(group);
    mocks.getWorkspaces.mockReturnValue([group]);
    mocks.getWorktreeWorkspaces.mockReturnValueOnce([ws1, dashboardWs]);

    await archiveWorkspace("g-1");

    const stored = get(archivedDefs).workspaces["g-1"];
    expect(stored?.nestedWorkspaceDefs).toHaveLength(1);
    expect(stored?.nestedWorkspaceDefs[0]?.id).toBe("ws-1");
  });
});

describe("unarchiveWorkspace", () => {
  it("is a no-op when the group is not in the archive", async () => {
    await unarchiveWorkspace("g-missing");
    expect(mocks.setWorkspaces).not.toHaveBeenCalled();
    expect(mocks.appendRootRow).not.toHaveBeenCalled();
    expect(mocks.createNestedWorkspaceFromDef).not.toHaveBeenCalled();
    expect(mocks.provisionAutoDashboardsForWorkspace).not.toHaveBeenCalled();
  });

  it("restores the group, appends root row, creates nestedWorkspaces, and provisions dashboards", async () => {
    const group = makeWorkspace();
    const def1 = { id: "ws-1", name: "W1", layout: { pane: { surfaces: [] } } };
    const def2 = { id: "ws-2", name: "W2", layout: { pane: { surfaces: [] } } };
    addToArchive("g-1", {
      workspace: group,
      nestedWorkspaceDefs: [def1, def2],
    });
    mocks.getWorkspaces.mockReturnValueOnce([{ id: "existing" }]);

    await unarchiveWorkspace("g-1");

    expect(mocks.setWorkspaces).toHaveBeenCalledWith([
      { id: "existing" },
      group,
    ]);
    expect(mocks.appendRootRow).toHaveBeenCalledWith({
      kind: "workspace",
      id: "g-1",
    });
    expect(mocks.createNestedWorkspaceFromDef).toHaveBeenCalledTimes(2);
    expect(mocks.createNestedWorkspaceFromDef).toHaveBeenNthCalledWith(
      1,
      def1,
      {
        restoring: true,
      },
    );
    expect(mocks.createNestedWorkspaceFromDef).toHaveBeenNthCalledWith(
      2,
      def2,
      {
        restoring: true,
      },
    );
    expect(mocks.provisionAutoDashboardsForWorkspace).toHaveBeenCalledWith(
      group,
    );

    // archive entry cleared on success
    expect(get(archivedOrder)).toHaveLength(0);
    expect(get(archivedDefs).workspaces["g-1"]).toBeUndefined();
  });

  it("does NOT remove the archive entry when createNestedWorkspaceFromDef rejects", async () => {
    const group = makeWorkspace();
    const def = {
      id: "ws-1",
      name: "W1",
      layout: { pane: { surfaces: [] } },
    };
    addToArchive("g-1", {
      workspace: group,
      nestedWorkspaceDefs: [def],
    });
    mocks.createNestedWorkspaceFromDef.mockRejectedValueOnce(new Error("nope"));

    await expect(unarchiveWorkspace("g-1")).rejects.toThrow("nope");

    // archive entry must survive so the user can retry
    expect(get(archivedOrder)).toEqual(["g-1"]);
    expect(get(archivedDefs).workspaces["g-1"]).toBeDefined();
    expect(mocks.provisionAutoDashboardsForWorkspace).not.toHaveBeenCalled();
  });
});
