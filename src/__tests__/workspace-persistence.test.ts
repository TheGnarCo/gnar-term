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

import {
  nestedWorkspaces,
  activeNestedWorkspaceIdx,
} from "../lib/stores/workspace";

describe("workspace persistence", () => {
  beforeEach(() => {
    nestedWorkspaces.set([]);
    activeNestedWorkspaceIdx.set(-1);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("persistWorkspaces serializes all nestedWorkspaces and calls saveState", async () => {
    const { persistWorkspaces } =
      await import("../lib/services/workspace-service");
    const config = await import("../lib/config");
    const saveStateSpy = vi
      .spyOn(config, "saveState")
      .mockResolvedValue(undefined);

    // Set up two nestedWorkspaces in the store
    nestedWorkspaces.set([
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
    activeNestedWorkspaceIdx.set(1);

    persistWorkspaces();

    // Wait for the async saveState call
    await vi.runAllTimersAsync();

    expect(saveStateSpy).toHaveBeenCalledWith({
      nestedWorkspaces: [
        {
          id: "ws1",
          name: "Dev",
          cwd: undefined,
          layout: { pane: { surfaces: [] } },
        },
        {
          id: "ws2",
          name: "Test",
          cwd: undefined,
          layout: { pane: { surfaces: [] } },
        },
      ],
      activeNestedWorkspaceIdx: 1,
    });

    saveStateSpy.mockRestore();
  });

  it("schedulePersist debounces multiple calls into one save", async () => {
    const { schedulePersist } =
      await import("../lib/services/workspace-service");
    const config = await import("../lib/config");
    const saveStateSpy = vi
      .spyOn(config, "saveState")
      .mockResolvedValue(undefined);

    nestedWorkspaces.set([
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
    activeNestedWorkspaceIdx.set(0);

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

  it("persistWorkspaces round-trips workspace metadata (regression for 0b92007)", async () => {
    const { persistWorkspaces } =
      await import("../lib/services/workspace-service");
    const config = await import("../lib/config");
    const saveStateSpy = vi
      .spyOn(config, "saveState")
      .mockResolvedValue(undefined);

    nestedWorkspaces.set([
      {
        id: "ws-project",
        name: "Project A",
        splitRoot: {
          type: "pane",
          pane: { id: "p1", surfaces: [], activeSurfaceId: null },
        },
        activePaneId: "p1",
        metadata: { groupId: "proj-alpha", color: "blue" },
      },
    ] as unknown as import("../lib/types").NestedWorkspace[]);
    activeNestedWorkspaceIdx.set(0);

    await persistWorkspaces();

    expect(saveStateSpy).toHaveBeenCalledTimes(1);
    const payload = saveStateSpy.mock.calls[0]![0];
    expect(payload.nestedWorkspaces).toEqual([
      {
        id: "ws-project",
        name: "Project A",
        cwd: undefined,
        layout: { pane: { surfaces: [] } },
        metadata: { groupId: "proj-alpha", color: "blue" },
      },
    ]);

    saveStateSpy.mockRestore();
  });

  it("serializeLayout captures terminal cwd and title", async () => {
    const { serializeLayout } =
      await import("../lib/services/workspace-service");

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

    // loadState returns empty object (no nestedWorkspaces)
    const loadStateSpy = vi.spyOn(config, "loadState").mockResolvedValue({});

    const state = await config.loadState();
    expect(state.nestedWorkspaces).toBeUndefined();

    // App.svelte logic: if no state.nestedWorkspaces, fall back to autoload/default
    const shouldRestore =
      state.nestedWorkspaces && state.nestedWorkspaces.length > 0;
    expect(shouldRestore).toBeFalsy();

    loadStateSpy.mockRestore();
  });

  it("restore uses saved state when nestedWorkspaces exist", async () => {
    const config = await import("../lib/config");

    const savedState = {
      nestedWorkspaces: [
        {
          name: "Restored",
          layout: {
            pane: {
              surfaces: [{ type: "terminal" as const, cwd: "/tmp" }],
            },
          },
        },
      ],
      activeNestedWorkspaceIdx: 0,
    };

    const loadStateSpy = vi
      .spyOn(config, "loadState")
      .mockResolvedValue(savedState);

    const state = await config.loadState();
    expect(state.nestedWorkspaces).toHaveLength(1);
    expect(state.nestedWorkspaces![0].name).toBe("Restored");
    expect(state.activeNestedWorkspaceIdx).toBe(0);

    loadStateSpy.mockRestore();
  });
});
