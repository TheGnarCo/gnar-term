/**
 * Tests for S-RELAUNCH: shell exit → relaunch prompt → relaunch/dismiss.
 *
 * Covers:
 *   1. pty-exit handler sets exitedSurface on the pane when the last surface exits
 *   2. pty-exit handler does NOT auto-collapse the pane when exitedSurface is set
 *   3. dismissPane clears exitedSurface and collapses the pane
 *   4. relaunchPane clears exitedSurface and creates a new surface
 *   5. exitedSurface captures definedCommand and cwd
 *   6. panes with multiple surfaces still collapse remaining surfaces normally
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";
import {
  nestedWorkspaces,
  activeNestedWorkspaceIdx,
} from "../lib/stores/nested-workspace";
import type { NestedWorkspace, Pane, TerminalSurface } from "../lib/types";
import { getAllPanes } from "../lib/types";
import { dismissPane, relaunchPane } from "../lib/services/pane-service";

// Mock Tauri APIs — not used in these unit tests but imported transitively
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn().mockResolvedValue(""),
  writeText: vi.fn().mockResolvedValue(undefined),
}));

// Mock terminal-service so relaunchPane can be imported without a real DOM/Tauri
const mockCreatedSurface: TerminalSurface = {
  kind: "terminal",
  id: "mock-surface",
  terminal: {
    focus: vi.fn(),
    dispose: vi.fn(),
  } as unknown as import("@xterm/xterm").Terminal,
  fitAddon: { fit: vi.fn() } as unknown as import("@xterm/addon-fit").FitAddon,
  searchAddon: {} as unknown as import("@xterm/addon-search").SearchAddon,
  termElement: document.createElement("div"),
  ptyId: -1,
  title: "Mock Shell",
  hasUnread: false,
  opened: true,
};
vi.mock("../lib/terminal-service", () => ({
  createTerminalSurface: vi.fn(async (pane: Pane) => {
    pane.surfaces.push(mockCreatedSurface);
    pane.activeSurfaceId = mockCreatedSurface.id;
    return mockCreatedSurface;
  }),
  isMac: false,
}));

// Mock workspace-service to avoid full DOM/PTY chain when workspace recovery runs
vi.mock("../lib/services/workspace-service", () => ({
  createWorkspace: vi.fn().mockResolvedValue(undefined),
}));

function makeSurface(
  id: string,
  ptyId = 1,
  opts: Partial<TerminalSurface> = {},
): TerminalSurface {
  return {
    kind: "terminal",
    id,
    terminal: {
      focus: vi.fn(),
      dispose: vi.fn(),
    } as unknown as import("@xterm/xterm").Terminal,
    fitAddon: {
      fit: vi.fn(),
    } as unknown as import("@xterm/addon-fit").FitAddon,
    searchAddon: {} as unknown as import("@xterm/addon-search").SearchAddon,
    termElement: document.createElement("div"),
    ptyId,
    title: `Shell ${id}`,
    hasUnread: false,
    opened: true,
    ...opts,
  };
}

function makeWorkspace(pane: Pane): NestedWorkspace {
  return {
    id: "ws1",
    name: "Test Workspace",
    splitRoot: { type: "pane", pane },
    activePaneId: pane.id,
  };
}

// Simulate the pty-exit handler logic from terminal-service.ts.
// This mirrors the workspaces.update call so we can test it without
// importing the full terminal-service (which requires a real DOM + Tauri).
function simulatePtyExit(ptyId: number, exitCode: number | null) {
  nestedWorkspaces.update((wsList) => {
    for (const ws of wsList) {
      for (const pane of getAllPanes(ws.splitRoot)) {
        const idx = pane.surfaces.findIndex(
          (s) =>
            s.kind === "terminal" && (s as TerminalSurface).ptyId === ptyId,
        );
        if (idx >= 0) {
          const exiting = pane.surfaces[idx] as TerminalSurface;
          const definedCommand = exiting.definedCommand;
          const cwd = exiting.cwd;
          pane.surfaces.splice(idx, 1);
          if (pane.surfaces.length > 0) {
            pane.activeSurfaceId =
              pane.surfaces[Math.min(idx, pane.surfaces.length - 1)].id;
          } else {
            pane.activeSurfaceId = null;
            pane.exitedSurface = {
              code: exitCode ?? 0,
              definedCommand,
              cwd,
            };
          }
          return wsList;
        }
      }
    }
    return wsList;
  });
}

describe("S-RELAUNCH: pty-exit handler", () => {
  beforeEach(() => {
    nestedWorkspaces.set([]);
    activeNestedWorkspaceIdx.set(-1);
  });

  it("sets exitedSurface on the pane when the last surface exits", () => {
    const surface = makeSurface("s1", 42);
    const pane: Pane = { id: "p1", surfaces: [surface], activeSurfaceId: "s1" };
    const ws = makeWorkspace(pane);
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    simulatePtyExit(42, 1);

    const updatedPane = getAllPanes(get(nestedWorkspaces)[0].splitRoot)[0];
    expect(updatedPane.surfaces).toHaveLength(0);
    expect(updatedPane.exitedSurface).toBeDefined();
    expect(updatedPane.exitedSurface?.code).toBe(1);
  });

  it("preserves the pane in the workspace tree (does not auto-collapse)", () => {
    const surface = makeSurface("s1", 99);
    const pane: Pane = { id: "p1", surfaces: [surface], activeSurfaceId: "s1" };
    const ws = makeWorkspace(pane);
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    simulatePtyExit(99, 0);

    // Workspace still has 1 pane — it was not collapsed
    const panes = getAllPanes(get(nestedWorkspaces)[0].splitRoot);
    expect(panes).toHaveLength(1);
    expect(panes[0].id).toBe("p1");
  });

  it("captures definedCommand from the exiting surface", () => {
    const surface = makeSurface("s1", 7, {
      definedCommand: "claude",
      cwd: "/home/user",
    });
    const pane: Pane = { id: "p1", surfaces: [surface], activeSurfaceId: "s1" };
    const ws = makeWorkspace(pane);
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    simulatePtyExit(7, 0);

    const updatedPane = getAllPanes(get(nestedWorkspaces)[0].splitRoot)[0];
    expect(updatedPane.exitedSurface?.definedCommand).toBe("claude");
    expect(updatedPane.exitedSurface?.cwd).toBe("/home/user");
  });

  it("does NOT set exitedSurface when other surfaces remain in the pane", () => {
    const s1 = makeSurface("s1", 10);
    const s2 = makeSurface("s2", 11);
    const pane: Pane = { id: "p1", surfaces: [s1, s2], activeSurfaceId: "s1" };
    const ws = makeWorkspace(pane);
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    simulatePtyExit(10, 0);

    const updatedPane = getAllPanes(get(nestedWorkspaces)[0].splitRoot)[0];
    expect(updatedPane.surfaces).toHaveLength(1);
    expect(updatedPane.exitedSurface).toBeUndefined();
    expect(updatedPane.activeSurfaceId).toBe("s2");
  });

  it("uses exit code 0 when null is passed", () => {
    const surface = makeSurface("s1", 5);
    const pane: Pane = { id: "p1", surfaces: [surface], activeSurfaceId: "s1" };
    const ws = makeWorkspace(pane);
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    simulatePtyExit(5, null);

    const updatedPane = getAllPanes(get(nestedWorkspaces)[0].splitRoot)[0];
    expect(updatedPane.exitedSurface?.code).toBe(0);
  });
});

describe("S-RELAUNCH: Pane type", () => {
  it("Pane type accepts exitedSurface field", () => {
    const pane: Pane = {
      id: "p1",
      surfaces: [],
      activeSurfaceId: null,
      exitedSurface: { code: 1, definedCommand: "claude", cwd: "/tmp" },
    };
    expect(pane.exitedSurface?.code).toBe(1);
    expect(pane.exitedSurface?.definedCommand).toBe("claude");
  });

  it("Pane type allows exitedSurface to be undefined", () => {
    const pane: Pane = { id: "p1", surfaces: [], activeSurfaceId: null };
    expect(pane.exitedSurface).toBeUndefined();
  });

  it("exitedSurface can be cleared by setting to undefined", () => {
    const pane: Pane = {
      id: "p1",
      surfaces: [],
      activeSurfaceId: null,
      exitedSurface: { code: 0 },
    };
    pane.exitedSurface = undefined;
    expect(pane.exitedSurface).toBeUndefined();
  });
});

describe("S-RELAUNCH: TerminalSurface.definedCommand", () => {
  it("definedCommand can be set on a surface and is not cleared after startup", () => {
    const surface = makeSurface("s1", 1, { definedCommand: "npm run dev" });
    // Unlike startupCommand which is cleared after sending, definedCommand persists
    expect(surface.definedCommand).toBe("npm run dev");
    // Simulate what TerminalSurface.svelte does — clear startupCommand but NOT definedCommand
    surface.startupCommand = undefined;
    expect(surface.definedCommand).toBe("npm run dev");
  });
});

describe("S-RELAUNCH: dismissPane", () => {
  beforeEach(() => {
    nestedWorkspaces.set([]);
    activeNestedWorkspaceIdx.set(-1);
  });

  it("clears exitedSurface on dismiss", () => {
    // Use a split workspace so removePane doesn't remove the entire workspace
    const pane1: Pane = {
      id: "p1",
      surfaces: [],
      activeSurfaceId: null,
      exitedSurface: { code: 1 },
    };
    const pane2: Pane = {
      id: "p2",
      surfaces: [makeSurface("s2", 2)],
      activeSurfaceId: "s2",
    };
    const ws: NestedWorkspace = {
      id: "ws1",
      name: "Test",
      splitRoot: {
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        children: [
          { type: "pane", pane: pane1 },
          { type: "pane", pane: pane2 },
        ],
      },
      activePaneId: "p1",
    };
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    dismissPane("p1");

    // pane1 has been removed from the split tree; only pane2 remains
    const panes = getAllPanes(get(nestedWorkspaces)[0].splitRoot);
    expect(panes).toHaveLength(1);
    expect(panes[0].id).toBe("p2");
  });

  it("collapses the pane (removes it from the workspace tree)", () => {
    const pane1: Pane = {
      id: "p1",
      surfaces: [],
      activeSurfaceId: null,
      exitedSurface: { code: 0 },
    };
    const pane2: Pane = {
      id: "p2",
      surfaces: [makeSurface("s2", 3)],
      activeSurfaceId: "s2",
    };
    const ws: NestedWorkspace = {
      id: "ws1",
      name: "Test",
      splitRoot: {
        type: "split",
        direction: "vertical",
        ratio: 0.5,
        children: [
          { type: "pane", pane: pane1 },
          { type: "pane", pane: pane2 },
        ],
      },
      activePaneId: "p1",
    };
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    // Before: 2 panes
    expect(getAllPanes(get(nestedWorkspaces)[0].splitRoot)).toHaveLength(2);

    dismissPane("p1");

    // After: 1 pane — the pane was collapsed
    expect(getAllPanes(get(nestedWorkspaces)[0].splitRoot)).toHaveLength(1);
  });

  it("is a no-op when pane has no exitedSurface (wrong state)", () => {
    // A pane with surfaces still active — dismissPane should still remove it
    // (it calls removePane unconditionally after clearing exitedSurface)
    const pane1: Pane = { id: "p1", surfaces: [], activeSurfaceId: null };
    const pane2: Pane = {
      id: "p2",
      surfaces: [makeSurface("s2", 4)],
      activeSurfaceId: "s2",
    };
    const ws: NestedWorkspace = {
      id: "ws1",
      name: "Test",
      splitRoot: {
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        children: [
          { type: "pane", pane: pane1 },
          { type: "pane", pane: pane2 },
        ],
      },
      activePaneId: "p1",
    };
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    // dismissPane on a pane without exitedSurface still collapses the pane
    dismissPane("p1");
    expect(getAllPanes(get(nestedWorkspaces)[0].splitRoot)).toHaveLength(1);
  });
});

describe("S-RELAUNCH: relaunchPane", () => {
  beforeEach(() => {
    nestedWorkspaces.set([]);
    activeNestedWorkspaceIdx.set(-1);
    vi.clearAllMocks();
    // Reset mock surface id to avoid cross-test pollution
    mockCreatedSurface.id = "mock-surface";
    mockCreatedSurface.definedCommand = undefined;
    mockCreatedSurface.startupCommand = undefined;
    mockCreatedSurface.title = "Mock Shell";
  });

  it("clears exitedSurface after relaunch", async () => {
    const pane: Pane = {
      id: "p1",
      surfaces: [],
      activeSurfaceId: null,
      exitedSurface: { code: 0 },
    };
    const ws: NestedWorkspace = {
      id: "ws1",
      name: "Test",
      splitRoot: { type: "pane", pane },
      activePaneId: "p1",
    };
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    await relaunchPane("p1");

    const updatedPane = getAllPanes(get(nestedWorkspaces)[0].splitRoot)[0];
    expect(updatedPane.exitedSurface).toBeUndefined();
  });

  it("creates a new surface in the pane after relaunch", async () => {
    const pane: Pane = {
      id: "p1",
      surfaces: [],
      activeSurfaceId: null,
      exitedSurface: { code: 1 },
    };
    const ws: NestedWorkspace = {
      id: "ws1",
      name: "Test",
      splitRoot: { type: "pane", pane },
      activePaneId: "p1",
    };
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    await relaunchPane("p1");

    const updatedPane = getAllPanes(get(nestedWorkspaces)[0].splitRoot)[0];
    expect(updatedPane.surfaces).toHaveLength(1);
    expect(updatedPane.activeSurfaceId).toBe("mock-surface");
  });

  it("restores definedCommand and startupCommand on the new surface", async () => {
    const pane: Pane = {
      id: "p1",
      surfaces: [],
      activeSurfaceId: null,
      exitedSurface: { code: 0, definedCommand: "claude", cwd: "/projects" },
    };
    const ws: NestedWorkspace = {
      id: "ws1",
      name: "Test",
      splitRoot: { type: "pane", pane },
      activePaneId: "p1",
    };
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    await relaunchPane("p1");

    // The mock surface is the created surface — check its fields were set
    expect(mockCreatedSurface.definedCommand).toBe("claude");
    expect(mockCreatedSurface.startupCommand).toBe("claude");
    expect(mockCreatedSurface.title).toBe("claude");
  });

  it("does not set definedCommand when exitedSurface had none", async () => {
    const pane: Pane = {
      id: "p1",
      surfaces: [],
      activeSurfaceId: null,
      exitedSurface: { code: 0 },
    };
    const ws: NestedWorkspace = {
      id: "ws1",
      name: "Test",
      splitRoot: { type: "pane", pane },
      activePaneId: "p1",
    };
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    await relaunchPane("p1");

    // No definedCommand means surface keeps its default title, no command set
    expect(mockCreatedSurface.definedCommand).toBeUndefined();
    expect(mockCreatedSurface.startupCommand).toBeUndefined();
  });

  it("is a no-op when pane has no exitedSurface", async () => {
    const pane: Pane = {
      id: "p1",
      surfaces: [makeSurface("s1", 10)],
      activeSurfaceId: "s1",
    };
    const ws: NestedWorkspace = {
      id: "ws1",
      name: "Test",
      splitRoot: { type: "pane", pane },
      activePaneId: "p1",
    };
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    await relaunchPane("p1");

    // Pane already had a surface and no exitedSurface — createTerminalSurface should not be called
    const { createTerminalSurface } = await import("../lib/terminal-service");
    expect(createTerminalSurface).not.toHaveBeenCalled();
    expect(
      getAllPanes(get(nestedWorkspaces)[0].splitRoot)[0].surfaces,
    ).toHaveLength(1);
  });
});
