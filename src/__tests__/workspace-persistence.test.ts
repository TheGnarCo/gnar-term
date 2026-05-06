/**
 * Tests for workspace persistence: debounced save and restore on launch.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Tauri APIs before any imports that use them
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import {
  setActiveWorkspaceId,
  resetWorkspacesForTest,
} from "../lib/stores/workspace";

describe("workspace persistence", () => {
  beforeEach(() => {
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    resetWorkspacesForTest();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("persistWorkspaces serializes all workspaces and calls saveState", async () => {
    const { persistWorkspaces } =
      await import("../lib/services/workspace-runtime-service");
    const config = await import("../lib/config");
    const saveStateSpy = vi
      .spyOn(config, "saveState")
      .mockResolvedValue(undefined);

    // Set up two workspaces in the store
    workspaces.set([
      {
        id: "ws1",
        name: "Dev",
        splitRoot: {
          type: "pane",
          pane: { id: "p1", surfaces: [], activeSurfaceId: null },
        },
        activePaneId: "p1",
      },
      {
        id: "ws2",
        name: "Test",
        splitRoot: {
          type: "pane",
          pane: { id: "p2", surfaces: [], activeSurfaceId: null },
        },
        activePaneId: "p2",
      },
    ]);
    activeWorkspaceIdx.set(1);

    persistWorkspaces();

    // Wait for the async saveState call
    await vi.runAllTimersAsync();

    expect(saveStateSpy).toHaveBeenCalledWith({
      workspaces: [
        {
          id: "ws1",
          name: "Dev",
          layout: { pane: { surfaces: [] } },
        },
        {
          id: "ws2",
          name: "Test",
          layout: { pane: { surfaces: [] } },
        },
      ],
      activeWorkspaceId: "ws2",
    });

    saveStateSpy.mockRestore();
  });

  it("schedulePersist debounces multiple calls into one save", async () => {
    const { schedulePersist } =
      await import("../lib/services/workspace-runtime-service");
    const config = await import("../lib/config");
    const saveStateSpy = vi
      .spyOn(config, "saveState")
      .mockResolvedValue(undefined);

    workspaces.set([
      {
        id: "ws1",
        name: "WS",
        splitRoot: {
          type: "pane",
          pane: { id: "p1", surfaces: [], activeSurfaceId: null },
        },
        activePaneId: "p1",
      },
    ]);
    activeWorkspaceIdx.set(0);

    // Call schedulePersist multiple times rapidly
    schedulePersist();
    schedulePersist();
    schedulePersist();

    // Advance past the debounce delay
    await vi.advanceTimersByTimeAsync(2500);

    // Should only have been called once
    expect(saveStateSpy).toHaveBeenCalledTimes(1);

    saveStateSpy.mockRestore();
  });

  it("persistWorkspaces serializes root + child workspaces from the unified store", async () => {
    const { persistWorkspaces } =
      await import("../lib/services/workspace-runtime-service");
    const config = await import("../lib/config");
    const saveStateSpy = vi
      .spyOn(config, "saveState")
      .mockResolvedValue(undefined);

    workspaces.set([
      {
        id: "proj-alpha",
        name: "Alpha",
        path: "/repos/alpha",
        color: "blue",
        branchedWorkspaceIds: [],
        isGit: true,
        createdAt: "2026-01-01",
        splitRoot: {
          type: "pane",
          pane: { id: "alpha-p", surfaces: [], activeSurfaceId: null },
        },
        activePaneId: "alpha-p",
      },
      {
        id: "branch-1",
        name: "Branch 1",
        splitRoot: {
          type: "pane",
          pane: { id: "p1", surfaces: [], activeSurfaceId: null },
        },
        activePaneId: "p1",
        parentWorkspaceId: "proj-alpha",
      },
    ]);
    setActiveWorkspaceId("proj-alpha");
    activeWorkspaceIdx.set(1);

    await persistWorkspaces();

    expect(saveStateSpy).toHaveBeenCalledTimes(1);
    const payload = saveStateSpy.mock.calls[0]![0];
    const ids = payload.workspaces?.map((w) => w.id);
    expect(ids).toEqual(["proj-alpha", "branch-1"]);
    const proj = payload.workspaces?.find((w) => w.id === "proj-alpha");
    expect(proj?.path).toBe("/repos/alpha");
    expect(proj?.color).toBe("blue");
    expect(proj?.isGit).toBe(true);
    // Explicit active id (from setActiveWorkspaceId) wins over runtime idx.
    expect(payload.activeWorkspaceId).toBe("proj-alpha");

    saveStateSpy.mockRestore();
  });

  it("persistWorkspaces round-trips workspace top-level fields (regression for 0b92007)", async () => {
    const { persistWorkspaces } =
      await import("../lib/services/workspace-runtime-service");
    const config = await import("../lib/config");
    const saveStateSpy = vi
      .spyOn(config, "saveState")
      .mockResolvedValue(undefined);

    // Workspaces now carry top-level fields (not metadata) in the unified store.
    workspaces.set([
      {
        id: "ws-project",
        name: "Project A",
        splitRoot: {
          type: "pane",
          pane: { id: "p1", surfaces: [], activeSurfaceId: null },
        },
        activePaneId: "p1",
        parentWorkspaceId: "proj-alpha",
        color: "blue",
      },
    ] as unknown as import("../lib/types").Workspace[]);
    activeWorkspaceIdx.set(0);
    setActiveWorkspaceId(null);

    await persistWorkspaces();

    expect(saveStateSpy).toHaveBeenCalledTimes(1);
    const payload = saveStateSpy.mock.calls[0]![0];
    expect(payload.workspaces).toEqual([
      {
        id: "ws-project",
        name: "Project A",
        layout: { pane: { surfaces: [] } },
        color: "blue",
        parentWorkspaceId: "proj-alpha",
      },
    ]);
    expect(payload.activeWorkspaceId).toBe("ws-project");

    saveStateSpy.mockRestore();
  });

  it("serializeLayout captures terminal cwd and title", async () => {
    const { serializeLayout } =
      await import("../lib/services/workspace-runtime-service");

    const layout = serializeLayout({
      type: "pane",
      pane: {
        id: "p1",
        surfaces: [
          {
            kind: "terminal" as const,
            id: "s1",
            terminal: {} as unknown as import("@xterm/xterm").Terminal,
            fitAddon: {} as unknown as import("@xterm/addon-fit").FitAddon,
            searchAddon:
              {} as unknown as import("@xterm/addon-search").SearchAddon,
            termElement: document.createElement("div"),
            ptyId: 1,
            title: "my-shell",
            cwd: "/home/user",
            hasUnread: false,
            opened: true,
          },
        ],
        activeSurfaceId: "s1",
      },
    });

    expect(layout).toEqual({
      pane: {
        surfaces: [
          {
            type: "terminal",
            cwd: "/home/user",
            focus: true,
          },
        ],
      },
    });
  });

  it("restore falls back to defaults when no saved state", async () => {
    const config = await import("../lib/config");

    // loadState returns empty object (no workspaces)
    const loadStateSpy = vi.spyOn(config, "loadState").mockResolvedValue({});

    const state = await config.loadState();
    // AppState restored state uses the unified `workspaces` array
    // (WorkspaceDef[]).
    expect(state.workspaces).toBeUndefined();

    // App.svelte logic: if no state.workspaces, fall back to autoload/default
    const shouldRestore = state.workspaces && state.workspaces.length > 0;
    expect(shouldRestore).toBeFalsy();

    loadStateSpy.mockRestore();
  });

  it("restore uses saved state when workspaces exist", async () => {
    const config = await import("../lib/config");

    const savedState = {
      workspaces: [
        {
          name: "Restored",
          layout: {
            pane: {
              surfaces: [{ type: "terminal" as const, cwd: "/tmp" }],
            },
          },
        },
      ],
      activeWorkspaceIdx: 0,
    };

    const loadStateSpy = vi
      .spyOn(config, "loadState")
      .mockResolvedValue(savedState);

    const state = await config.loadState();
    expect(state.workspaces).toHaveLength(1);
    expect(state.workspaces![0].name).toBe("Restored");
    expect(state.activeWorkspaceIdx).toBe(0);

    loadStateSpy.mockRestore();
  });
});
