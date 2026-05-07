import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

const mocks = vi.hoisted(() => ({
  closeWorkspace: vi.fn(),
  createWorkspaceFromDef: vi.fn(() => Promise.resolve("new-ws-id")),
  serializeLayout: vi.fn(() => ({ pane: { surfaces: [] } })),
  schedulePersist: vi.fn(),
  showConfirmPrompt: vi.fn(() => Promise.resolve(true)),
  getWorkspace: vi.fn(() => undefined as unknown),
  getWorkspaces: vi.fn(() => [] as unknown[]),
  setWorkspaces: vi.fn(),
  getBranchesOfWorkspace: vi.fn(() => [] as unknown[]),
  closeWorkspacesInWorkspace: vi.fn(),
  provisionAutoDashboardsForWorkspace: vi.fn(() => Promise.resolve()),
  activateWorkspace: vi.fn(() => Promise.resolve()),
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

vi.mock("../lib/stores/workspace", async () => {
  const { writable } = await import("svelte/store");
  return {
    workspaces: writable([]),
    activeWorkspaceIdx: writable(0),
    activeWorkspace: writable(null),
    activeSurface: writable(null),
    activePseudoWorkspaceId: writable(null),
    zoomedSurfaceId: writable(null),
    getWorkspace: mocks.getWorkspace,
    getWorkspaces: mocks.getWorkspaces,
    setWorkspaces: mocks.setWorkspaces,
  };
});

vi.mock("../lib/services/workspace-runtime-service", () => ({
  closeWorkspace: mocks.closeWorkspace,
  createWorkspaceFromDef: mocks.createWorkspaceFromDef,
  serializeLayout: mocks.serializeLayout,
  schedulePersist: mocks.schedulePersist,
}));

vi.mock("../lib/services/workspace-service", () => ({
  getBranchesOfWorkspace: mocks.getBranchesOfWorkspace,
  closeWorkspacesInWorkspace: mocks.closeWorkspacesInWorkspace,
  provisionAutoDashboardsForWorkspace:
    mocks.provisionAutoDashboardsForWorkspace,
  activateWorkspace: mocks.activateWorkspace,
  isDashboardWorkspace: (ws: { metadata?: { isDashboard?: boolean } }) =>
    ws.metadata?.isDashboard === true,
}));

vi.mock("../lib/stores/root-row-order", () => ({
  removeRootRow: mocks.removeRootRow,
  appendRootRow: mocks.appendRootRow,
}));

vi.mock("../lib/stores/ui", () => ({
  showConfirmPrompt: mocks.showConfirmPrompt,
}));

import { workspaces, activeWorkspace } from "../lib/stores/workspace";
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
  workspaces.set([]);
  (activeWorkspace as unknown as { set: (v: unknown) => void }).set(null);
  mocks.showConfirmPrompt.mockImplementation(() => Promise.resolve(true));
  mocks.createWorkspaceFromDef.mockImplementation(() =>
    Promise.resolve("new-ws-id"),
  );
  mocks.getWorkspace.mockReturnValue(undefined);
  mocks.getWorkspaces.mockReturnValue([]);
  mocks.getBranchesOfWorkspace.mockReturnValue([]);
  mocks.provisionAutoDashboardsForWorkspace.mockImplementation(() =>
    Promise.resolve(),
  );
  mocks.activateWorkspace.mockImplementation(() => Promise.resolve());
});

function makeWorkspace(overrides = {}) {
  return {
    id: "g-1",
    name: "My Workspace",
    path: "/foo",
    color: "blue",
    branchedWorkspaceIds: ["ws-1", "ws-2", "ws-dash"],
    isGit: false,
    createdAt: "2026-01-01",
    ...overrides,
  };
}

function makeRunningTerminalWs(id: string, name: string, ptyId: number) {
  return {
    id,
    name,
    paneLayout: {
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
  it("returns false when the workspace is not found", async () => {
    mocks.getWorkspace.mockReturnValueOnce(undefined);
    const result = await archiveWorkspace("g-missing");
    expect(result).toBe(false);
    expect(mocks.closeWorkspacesInWorkspace).not.toHaveBeenCalled();
    expect(mocks.setWorkspaces).not.toHaveBeenCalled();
  });

  it("skips dashboard workspaces when counting running PTYs", async () => {
    const workspace = makeWorkspace();
    const dashboardWs = {
      ...makeRunningTerminalWs("ws-dash", "Dashboard", 99),
      metadata: { isDashboard: true },
    };
    mocks.getWorkspace.mockReturnValueOnce(workspace);
    mocks.getWorkspaces.mockReturnValue([workspace]);
    // Only the dashboard has a running PTY — counting it would prompt;
    // skipping it should not.
    mocks.getBranchesOfWorkspace.mockReturnValueOnce([dashboardWs]);

    const result = await archiveWorkspace("g-1");

    expect(mocks.showConfirmPrompt).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("closes workspaces, removes workspace, removes root row, and adds to archive", async () => {
    const workspace = makeWorkspace();
    const ws1 = makeRunningTerminalWs("ws-1", "W1", -1);
    const ws2 = makeRunningTerminalWs("ws-2", "W2", -1);
    mocks.getWorkspace.mockReturnValueOnce(workspace);
    mocks.getWorkspaces.mockReturnValue([workspace, { id: "other" }]);
    mocks.getBranchesOfWorkspace.mockReturnValueOnce([ws1, ws2]);

    const result = await archiveWorkspace("g-1");

    expect(result).toBe(true);
    expect(mocks.closeWorkspacesInWorkspace).toHaveBeenCalledWith("g-1");
    expect(mocks.setWorkspaces).toHaveBeenCalledWith([{ id: "other" }]);
    expect(mocks.removeRootRow).toHaveBeenCalledWith({
      kind: "workspace",
      id: "g-1",
    });
    // Order matters: the root Workspace must be removed from the
    // workspaces store BEFORE its Branches close. The close path emits
    // `workspace:closed`, which `setupPrimaryWorkspaceAutoRecreation`
    // listens for; if the root Workspace is still present it will spawn
    // a phantom replacement Branch whose `rootWorkspaceId` then dangles.
    const setOrder = mocks.setWorkspaces.mock.invocationCallOrder[0]!;
    const closeOrder =
      mocks.closeWorkspacesInWorkspace.mock.invocationCallOrder[0]!;
    expect(setOrder).toBeLessThan(closeOrder);
    expect(get(archivedOrder)).toEqual(["g-1"]);
    const stored = get(archivedDefs).workspaces["g-1"];
    expect(stored?.workspace).toEqual(workspace);
    expect(stored?.childWorkspaceDefs).toHaveLength(2);
    expect(stored?.childWorkspaceDefs[0]?.name).toBe("W1");
    expect(stored?.childWorkspaceDefs[1]?.name).toBe("W2");
  });

  it("returns false when the user cancels the confirm prompt", async () => {
    const workspace = makeWorkspace();
    const wsRunning = makeRunningTerminalWs("ws-1", "W1", 42);
    mocks.getWorkspace.mockReturnValueOnce(workspace);
    mocks.getBranchesOfWorkspace.mockReturnValueOnce([wsRunning]);
    mocks.showConfirmPrompt.mockResolvedValueOnce(false);

    const result = await archiveWorkspace("g-1");

    expect(result).toBe(false);
    expect(mocks.closeWorkspacesInWorkspace).not.toHaveBeenCalled();
    expect(mocks.setWorkspaces).not.toHaveBeenCalled();
    expect(get(archivedOrder)).toHaveLength(0);
  });

  it("activates the next root workspace when archive leaves a dashboard active", async () => {
    const workspace = makeWorkspace();
    const nextRoot = { id: "g-next", name: "Next" };
    mocks.getWorkspace.mockReturnValueOnce(workspace);
    // After the archive operations land, simulate the runtime active idx
    // having clamped onto a dashboard chip belonging to another workspace.
    (activeWorkspace as unknown as { set: (v: unknown) => void }).set({
      id: "dash-x",
      isDashboard: true,
    });
    // First call (filter) returns roots minus the archived; second call
    // (post-archive lookup of remaining roots) returns the same set.
    mocks.getWorkspaces.mockReturnValue([nextRoot]);

    const result = await archiveWorkspace("g-1");

    expect(result).toBe(true);
    expect(mocks.activateWorkspace).toHaveBeenCalledWith("g-next");
  });

  it("activates the next root workspace when archive leaves no active workspace", async () => {
    const workspace = makeWorkspace();
    const nextRoot = { id: "g-next", name: "Next" };
    mocks.getWorkspace.mockReturnValueOnce(workspace);
    (activeWorkspace as unknown as { set: (v: unknown) => void }).set(null);
    mocks.getWorkspaces.mockReturnValue([nextRoot]);

    await archiveWorkspace("g-1");

    expect(mocks.activateWorkspace).toHaveBeenCalledWith("g-next");
  });

  it("does not re-activate when archive leaves a non-dashboard workspace active", async () => {
    const workspace = makeWorkspace();
    mocks.getWorkspace.mockReturnValueOnce(workspace);
    (activeWorkspace as unknown as { set: (v: unknown) => void }).set({
      id: "g-other",
      isDashboard: false,
    });
    mocks.getWorkspaces.mockReturnValue([{ id: "g-other" }]);

    await archiveWorkspace("g-1");

    expect(mocks.activateWorkspace).not.toHaveBeenCalled();
  });

  it("serializes only non-dashboard workspaces into the archived defs", async () => {
    const workspace = makeWorkspace();
    const ws1 = makeRunningTerminalWs("ws-1", "Real", -1);
    const dashboardWs = {
      ...makeRunningTerminalWs("ws-dash", "Dashboard", -1),
      metadata: { isDashboard: true },
    };
    mocks.getWorkspace.mockReturnValueOnce(workspace);
    mocks.getWorkspaces.mockReturnValue([workspace]);
    mocks.getBranchesOfWorkspace.mockReturnValueOnce([ws1, dashboardWs]);

    await archiveWorkspace("g-1");

    const stored = get(archivedDefs).workspaces["g-1"];
    expect(stored?.childWorkspaceDefs).toHaveLength(1);
    expect(stored?.childWorkspaceDefs[0]?.id).toBe("ws-1");
  });
});

describe("unarchiveWorkspace", () => {
  it("is a no-op when the workspace is not in the archive", async () => {
    await unarchiveWorkspace("g-missing");
    expect(mocks.setWorkspaces).not.toHaveBeenCalled();
    expect(mocks.appendRootRow).not.toHaveBeenCalled();
    expect(mocks.createWorkspaceFromDef).not.toHaveBeenCalled();
    expect(mocks.provisionAutoDashboardsForWorkspace).not.toHaveBeenCalled();
  });

  it("restores the workspace, appends root row, creates workspaces, and provisions dashboards", async () => {
    const workspace = makeWorkspace();
    const def1 = { id: "ws-1", name: "W1", layout: { pane: { surfaces: [] } } };
    const def2 = { id: "ws-2", name: "W2", layout: { pane: { surfaces: [] } } };
    addToArchive("g-1", {
      workspace,
      childWorkspaceDefs: [def1, def2],
    });
    mocks.getWorkspaces.mockReturnValueOnce([{ id: "existing" }]);

    await unarchiveWorkspace("g-1");

    expect(mocks.setWorkspaces).toHaveBeenCalledWith([
      { id: "existing" },
      workspace,
    ]);
    expect(mocks.appendRootRow).toHaveBeenCalledWith({
      kind: "workspace",
      id: "g-1",
    });
    expect(mocks.createWorkspaceFromDef).toHaveBeenCalledTimes(2);
    expect(mocks.createWorkspaceFromDef).toHaveBeenNthCalledWith(1, def1, {
      restoring: true,
    });
    expect(mocks.createWorkspaceFromDef).toHaveBeenNthCalledWith(2, def2, {
      restoring: true,
    });
    expect(mocks.provisionAutoDashboardsForWorkspace).toHaveBeenCalledWith(
      workspace,
    );

    // archive entry cleared on success
    expect(get(archivedOrder)).toHaveLength(0);
    expect(get(archivedDefs).workspaces["g-1"]).toBeUndefined();
  });

  it("does NOT remove the archive entry when createWorkspaceFromDef rejects", async () => {
    const workspace = makeWorkspace();
    const def = {
      id: "ws-1",
      name: "W1",
      layout: { pane: { surfaces: [] } },
    };
    addToArchive("g-1", {
      workspace,
      childWorkspaceDefs: [def],
    });
    mocks.createWorkspaceFromDef.mockRejectedValueOnce(new Error("nope"));

    await expect(unarchiveWorkspace("g-1")).rejects.toThrow("nope");

    // archive entry must survive so the user can retry
    expect(get(archivedOrder)).toEqual(["g-1"]);
    expect(get(archivedDefs).workspaces["g-1"]).toBeDefined();
    expect(mocks.provisionAutoDashboardsForWorkspace).not.toHaveBeenCalled();
  });
});
