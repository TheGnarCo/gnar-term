import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

const mocks = vi.hoisted(() => ({
  closeWorkspace: vi.fn(),
  createWorkspaceFromDef: vi.fn(() => Promise.resolve("new-ws-id")),
  serializeLayout: vi.fn(() => ({ pane: { surfaces: [] } })),
  schedulePersist: vi.fn(),
  showConfirmPrompt: vi.fn(() => Promise.resolve(true)),
  getWorkspaceGroup: vi.fn(() => undefined as unknown),
  getWorkspaceGroups: vi.fn(() => [] as unknown[]),
  setWorkspaceGroups: vi.fn(),
  getWorktreeWorkspaces: vi.fn(() => [] as unknown[]),
  closeWorkspacesInGroup: vi.fn(),
  provisionAutoDashboardsForGroup: vi.fn(() => Promise.resolve()),
  removeRootRow: vi.fn(),
  appendRootRow: vi.fn(),
}));

vi.mock("../lib/config", () => ({
  saveState: vi.fn(() => Promise.resolve()),
  getState: vi.fn(() => ({
    archivedOrder: [],
    archivedDefs: { nestedWorkspaces: {}, groups: {} },
  })),
}));

vi.mock("../lib/stores/workspace", async () => {
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

vi.mock("../lib/services/workspace-service", () => ({
  closeWorkspace: mocks.closeWorkspace,
  createWorkspaceFromDef: mocks.createWorkspaceFromDef,
  serializeLayout: mocks.serializeLayout,
  schedulePersist: mocks.schedulePersist,
}));

vi.mock("../lib/stores/workspace-groups", () => ({
  getWorkspaceGroup: mocks.getWorkspaceGroup,
  getWorkspaceGroups: mocks.getWorkspaceGroups,
  setWorkspaceGroups: mocks.setWorkspaceGroups,
}));

vi.mock("../lib/services/workspace-group-service", () => ({
  getWorktreeWorkspaces: mocks.getWorktreeWorkspaces,
  closeWorkspacesInGroup: mocks.closeWorkspacesInGroup,
  provisionAutoDashboardsForGroup: mocks.provisionAutoDashboardsForGroup,
}));

vi.mock("../lib/stores/root-row-order", () => ({
  removeRootRow: mocks.removeRootRow,
  appendRootRow: mocks.appendRootRow,
}));

vi.mock("../lib/stores/ui", () => ({
  showConfirmPrompt: mocks.showConfirmPrompt,
}));

import { nestedWorkspaces } from "../lib/stores/workspace";
import {
  initArchiveFromState,
  archivedOrder,
  archivedDefs,
  addToArchive,
} from "../lib/stores/archive";
import {
  archiveWorkspace,
  unarchiveWorkspace,
  archiveGroup,
  unarchiveGroup,
} from "../lib/services/archive-service";

function makeWs(overrides = {}) {
  return {
    id: "ws-1",
    name: "My WS",
    splitRoot: {
      type: "pane" as const,
      pane: { id: "p1", surfaces: [], activeSurfaceId: null },
    },
    activePaneId: "p1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  initArchiveFromState();
  nestedWorkspaces.set([]);
  mocks.showConfirmPrompt.mockImplementation(() => Promise.resolve(true));
  mocks.createWorkspaceFromDef.mockImplementation(() =>
    Promise.resolve("new-ws-id"),
  );
  mocks.getWorkspaceGroup.mockReturnValue(undefined);
  mocks.getWorkspaceGroups.mockReturnValue([]);
  mocks.getWorktreeWorkspaces.mockReturnValue([]);
  mocks.provisionAutoDashboardsForGroup.mockImplementation(() =>
    Promise.resolve(),
  );
});

function makeGroup(overrides = {}) {
  return {
    id: "g-1",
    name: "My Group",
    path: "/foo",
    color: "blue",
    workspaceIds: ["ws-1", "ws-2", "ws-dash"],
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
  it("serializes workspace, closes it, and adds to archive", async () => {
    nestedWorkspaces.set([makeWs()]);
    const result = await archiveWorkspace("ws-1");
    expect(result).toBe(true);
    expect(mocks.closeWorkspace).toHaveBeenCalledWith(0);
    expect(get(archivedOrder)).toEqual([{ kind: "workspace", id: "ws-1" }]);
    expect(get(archivedDefs).nestedWorkspaces["ws-1"]?.def.name).toBe("My WS");
  });

  it("returns false for an unknown workspace id", async () => {
    nestedWorkspaces.set([]);
    const result = await archiveWorkspace("nonexistent");
    expect(result).toBe(false);
    expect(mocks.closeWorkspace).not.toHaveBeenCalled();
  });

  it("shows confirm prompt when workspace has running PTY", async () => {
    const wsWithPty = makeWs({
      splitRoot: {
        type: "pane" as const,
        pane: {
          id: "p1",
          activeSurfaceId: "s1",
          surfaces: [
            {
              kind: "terminal",
              id: "s1",
              title: "bash",
              ptyId: 42,
              hasUnread: false,
              cwd: "/",
              terminal: {},
              pendingData: [],
            },
          ],
        },
      },
    });
    nestedWorkspaces.set([wsWithPty]);
    await archiveWorkspace("ws-1");
    expect(mocks.showConfirmPrompt).toHaveBeenCalled();
  });

  it("returns false when user cancels the confirm prompt", async () => {
    mocks.showConfirmPrompt.mockResolvedValueOnce(false);
    const wsWithPty = makeWs({
      splitRoot: {
        type: "pane" as const,
        pane: {
          id: "p1",
          activeSurfaceId: "s1",
          surfaces: [
            {
              kind: "terminal",
              id: "s1",
              title: "bash",
              ptyId: 42,
              hasUnread: false,
              cwd: "/",
              terminal: {},
              pendingData: [],
            },
          ],
        },
      },
    });
    nestedWorkspaces.set([wsWithPty]);
    const result = await archiveWorkspace("ws-1");
    expect(result).toBe(false);
    expect(mocks.closeWorkspace).not.toHaveBeenCalled();
  });
});

describe("unarchiveWorkspace", () => {
  it("restores workspace from frozen def and removes from archive", async () => {
    const def = {
      id: "ws-1",
      name: "My WS",
      layout: { pane: { surfaces: [] } },
    };
    addToArchive({ kind: "workspace", id: "ws-1" }, { def });
    await unarchiveWorkspace("ws-1");
    expect(mocks.createWorkspaceFromDef).toHaveBeenCalledWith(def, {
      restoring: true,
    });
    expect(get(archivedOrder)).toHaveLength(0);
    expect(get(archivedDefs).nestedWorkspaces["ws-1"]).toBeUndefined();
  });

  it("is a no-op for an unknown id", async () => {
    await unarchiveWorkspace("nonexistent");
    expect(mocks.createWorkspaceFromDef).not.toHaveBeenCalled();
  });

  it("keeps the archive entry intact when createWorkspaceFromDef rejects", async () => {
    const def = {
      id: "ws-1",
      name: "My WS",
      layout: { pane: { surfaces: [] } },
    };
    addToArchive({ kind: "workspace", id: "ws-1" }, { def });
    mocks.createWorkspaceFromDef.mockRejectedValueOnce(new Error("boom"));

    await expect(unarchiveWorkspace("ws-1")).rejects.toThrow("boom");

    // archive entry must survive so the user can retry
    expect(get(archivedOrder)).toEqual([{ kind: "workspace", id: "ws-1" }]);
    expect(get(archivedDefs).nestedWorkspaces["ws-1"]).toBeDefined();
  });
});

describe("archiveGroup", () => {
  it("returns false when the group is not found", async () => {
    mocks.getWorkspaceGroup.mockReturnValueOnce(undefined);
    const result = await archiveGroup("g-missing");
    expect(result).toBe(false);
    expect(mocks.closeWorkspacesInGroup).not.toHaveBeenCalled();
    expect(mocks.setWorkspaceGroups).not.toHaveBeenCalled();
  });

  it("skips dashboard nestedWorkspaces when counting running PTYs", async () => {
    const group = makeGroup();
    const dashboardWs = {
      ...makeRunningTerminalWs("ws-dash", "Dashboard", 99),
      metadata: { isDashboard: true },
    };
    mocks.getWorkspaceGroup.mockReturnValueOnce(group);
    mocks.getWorkspaceGroups.mockReturnValue([group]);
    // Only the dashboard has a running PTY — counting it would prompt;
    // skipping it should not.
    mocks.getWorktreeWorkspaces.mockReturnValueOnce([dashboardWs]);

    const result = await archiveGroup("g-1");

    expect(mocks.showConfirmPrompt).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("closes nestedWorkspaces, removes group, removes root row, and adds to archive", async () => {
    const group = makeGroup();
    const ws1 = makeRunningTerminalWs("ws-1", "W1", -1);
    const ws2 = makeRunningTerminalWs("ws-2", "W2", -1);
    mocks.getWorkspaceGroup.mockReturnValueOnce(group);
    mocks.getWorkspaceGroups.mockReturnValue([group, { id: "other" }]);
    mocks.getWorktreeWorkspaces.mockReturnValueOnce([ws1, ws2]);

    const result = await archiveGroup("g-1");

    expect(result).toBe(true);
    expect(mocks.closeWorkspacesInGroup).toHaveBeenCalledWith("g-1");
    expect(mocks.setWorkspaceGroups).toHaveBeenCalledWith([{ id: "other" }]);
    expect(mocks.removeRootRow).toHaveBeenCalledWith({
      kind: "workspace-group",
      id: "g-1",
    });
    expect(get(archivedOrder)).toEqual([
      { kind: "workspace-group", id: "g-1" },
    ]);
    const stored = get(archivedDefs).groups["g-1"];
    expect(stored?.group).toEqual(group);
    expect(stored?.workspaceDefs).toHaveLength(2);
    expect(stored?.workspaceDefs[0]?.name).toBe("W1");
    expect(stored?.workspaceDefs[1]?.name).toBe("W2");
  });

  it("returns false when the user cancels the confirm prompt", async () => {
    const group = makeGroup();
    const wsRunning = makeRunningTerminalWs("ws-1", "W1", 42);
    mocks.getWorkspaceGroup.mockReturnValueOnce(group);
    mocks.getWorktreeWorkspaces.mockReturnValueOnce([wsRunning]);
    mocks.showConfirmPrompt.mockResolvedValueOnce(false);

    const result = await archiveGroup("g-1");

    expect(result).toBe(false);
    expect(mocks.closeWorkspacesInGroup).not.toHaveBeenCalled();
    expect(mocks.setWorkspaceGroups).not.toHaveBeenCalled();
    expect(get(archivedOrder)).toHaveLength(0);
  });

  it("serializes only non-dashboard nestedWorkspaces into the archived defs", async () => {
    const group = makeGroup();
    const ws1 = makeRunningTerminalWs("ws-1", "Real", -1);
    const dashboardWs = {
      ...makeRunningTerminalWs("ws-dash", "Dashboard", -1),
      metadata: { isDashboard: true },
    };
    mocks.getWorkspaceGroup.mockReturnValueOnce(group);
    mocks.getWorkspaceGroups.mockReturnValue([group]);
    mocks.getWorktreeWorkspaces.mockReturnValueOnce([ws1, dashboardWs]);

    await archiveGroup("g-1");

    const stored = get(archivedDefs).groups["g-1"];
    expect(stored?.workspaceDefs).toHaveLength(1);
    expect(stored?.workspaceDefs[0]?.id).toBe("ws-1");
  });
});

describe("unarchiveGroup", () => {
  it("is a no-op when the group is not in the archive", async () => {
    await unarchiveGroup("g-missing");
    expect(mocks.setWorkspaceGroups).not.toHaveBeenCalled();
    expect(mocks.appendRootRow).not.toHaveBeenCalled();
    expect(mocks.createWorkspaceFromDef).not.toHaveBeenCalled();
    expect(mocks.provisionAutoDashboardsForGroup).not.toHaveBeenCalled();
  });

  it("restores the group, appends root row, creates nestedWorkspaces, and provisions dashboards", async () => {
    const group = makeGroup();
    const def1 = { id: "ws-1", name: "W1", layout: { pane: { surfaces: [] } } };
    const def2 = { id: "ws-2", name: "W2", layout: { pane: { surfaces: [] } } };
    addToArchive(
      { kind: "workspace-group", id: "g-1" },
      { group, workspaceDefs: [def1, def2] },
    );
    mocks.getWorkspaceGroups.mockReturnValueOnce([{ id: "existing" }]);

    await unarchiveGroup("g-1");

    expect(mocks.setWorkspaceGroups).toHaveBeenCalledWith([
      { id: "existing" },
      group,
    ]);
    expect(mocks.appendRootRow).toHaveBeenCalledWith({
      kind: "workspace-group",
      id: "g-1",
    });
    expect(mocks.createWorkspaceFromDef).toHaveBeenCalledTimes(2);
    expect(mocks.createWorkspaceFromDef).toHaveBeenNthCalledWith(1, def1, {
      restoring: true,
    });
    expect(mocks.createWorkspaceFromDef).toHaveBeenNthCalledWith(2, def2, {
      restoring: true,
    });
    expect(mocks.provisionAutoDashboardsForGroup).toHaveBeenCalledWith(group);

    // archive entry cleared on success
    expect(get(archivedOrder)).toHaveLength(0);
    expect(get(archivedDefs).groups["g-1"]).toBeUndefined();
  });

  it("does NOT remove the archive entry when createWorkspaceFromDef rejects", async () => {
    const group = makeGroup();
    const def = {
      id: "ws-1",
      name: "W1",
      layout: { pane: { surfaces: [] } },
    };
    addToArchive(
      { kind: "workspace-group", id: "g-1" },
      { group, workspaceDefs: [def] },
    );
    mocks.createWorkspaceFromDef.mockRejectedValueOnce(new Error("nope"));

    await expect(unarchiveGroup("g-1")).rejects.toThrow("nope");

    // archive entry must survive so the user can retry
    expect(get(archivedOrder)).toEqual([
      { kind: "workspace-group", id: "g-1" },
    ]);
    expect(get(archivedDefs).groups["g-1"]).toBeDefined();
    expect(mocks.provisionAutoDashboardsForGroup).not.toHaveBeenCalled();
  });
});
