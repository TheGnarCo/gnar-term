import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

const mocks = vi.hoisted(() => ({
  closeWorkspace: vi.fn(),
  createWorkspaceFromDef: vi.fn(() => Promise.resolve("new-ws-id")),
  serializeLayout: vi.fn(() => ({ pane: { surfaces: [] } })),
  schedulePersist: vi.fn(),
  showConfirmPrompt: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("../lib/config", () => ({
  saveState: vi.fn(() => Promise.resolve()),
  getState: vi.fn(() => ({
    archivedOrder: [],
    archivedDefs: { workspaces: {}, groups: {} },
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
  };
});

vi.mock("../lib/services/workspace-service", () => ({
  closeWorkspace: mocks.closeWorkspace,
  createWorkspaceFromDef: mocks.createWorkspaceFromDef,
  serializeLayout: mocks.serializeLayout,
  schedulePersist: mocks.schedulePersist,
}));

vi.mock("../lib/stores/workspace-groups", () => ({
  getWorkspaceGroup: vi.fn(() => undefined),
  getWorkspaceGroups: vi.fn(() => []),
  setWorkspaceGroups: vi.fn(),
}));

vi.mock("../lib/services/workspace-group-service", () => ({
  getWorkspacesInGroup: vi.fn(() => []),
  closeWorkspacesInGroup: vi.fn(),
  provisionAutoDashboardsForGroup: vi.fn(() => Promise.resolve()),
}));

vi.mock("../lib/stores/root-row-order", () => ({
  removeRootRow: vi.fn(),
  appendRootRow: vi.fn(),
}));

vi.mock("../lib/stores/ui", () => ({
  showConfirmPrompt: mocks.showConfirmPrompt,
}));

import { workspaces } from "../lib/stores/workspace";
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
  workspaces.set([]);
});

describe("archiveWorkspace", () => {
  it("serializes workspace, closes it, and adds to archive", async () => {
    workspaces.set([makeWs()]);
    const result = await archiveWorkspace("ws-1");
    expect(result).toBe(true);
    expect(mocks.closeWorkspace).toHaveBeenCalledWith(0);
    expect(get(archivedOrder)).toEqual([{ kind: "workspace", id: "ws-1" }]);
    expect(get(archivedDefs).workspaces["ws-1"]?.def.name).toBe("My WS");
  });

  it("returns false for an unknown workspace id", async () => {
    workspaces.set([]);
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
    workspaces.set([wsWithPty]);
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
    workspaces.set([wsWithPty]);
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
    expect(get(archivedDefs).workspaces["ws-1"]).toBeUndefined();
  });

  it("is a no-op for an unknown id", async () => {
    await unarchiveWorkspace("nonexistent");
    expect(mocks.createWorkspaceFromDef).not.toHaveBeenCalled();
  });
});
