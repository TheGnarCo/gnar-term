/**
 * E2E workflow integration tests.
 *
 * These tests exercise real service functions with mocked Tauri backend,
 * verifying multi-step workflows that span workspace, pane, and surface
 * operations — the kind of sequences a real user would perform.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { get } from "svelte/store";

// --- Mocks (must be before service imports) ---

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/terminal-service", () => ({
  createTerminalSurface: vi.fn(),
  isMac: false,
}));

vi.mock("../lib/config", () => ({
  saveState: vi.fn().mockResolvedValue(undefined),
  saveConfig: vi.fn().mockResolvedValue(undefined),
  getConfig: vi.fn().mockReturnValue({ commands: [] }),
}));

vi.mock("../lib/services/service-helpers", () => ({
  safeFocus: vi.fn(),
  getActiveCwd: vi.fn().mockResolvedValue(undefined),
  getCwdForSurface: vi.fn().mockResolvedValue(undefined),
}));

// --- Imports ---

import {
  workspaces,
  activeWorkspaceIdx,
  activeWorkspace,
  activePane,
  activeSurface,
} from "../lib/stores/workspace";
import type {
  NestedWorkspace,
  Pane,
  TerminalSurface,
  ExtensionSurface,
} from "../lib/types";
import { uid, getAllPanes } from "../lib/types";
import { createTerminalSurface } from "../lib/terminal-service";
import {
  createWorkspace,
  switchWorkspace,
  closeWorkspace,
} from "../lib/services/workspace-service";
import { splitPane, focusPane, closePane } from "../lib/services/pane-service";
import { getCwdForSurface } from "../lib/services/service-helpers";
import {
  openExtensionSurfaceInPane,
  closeSurfaceById,
  newSurface,
} from "../lib/services/surface-service";
import {
  registerSurfaceType,
  resetSurfaceTypes,
  surfaceTypeStore,
} from "../lib/services/surface-type-registry";

// --- Test helpers ---

function mockTerminalSurface(
  overrides: Partial<TerminalSurface> = {},
): TerminalSurface {
  return {
    kind: "terminal",
    id: uid(),
    terminal: {
      dispose: vi.fn(),
      focus: vi.fn(),
    } as unknown as TerminalSurface["terminal"],
    fitAddon: { fit: vi.fn() } as unknown as TerminalSurface["fitAddon"],
    searchAddon: {} as unknown as TerminalSurface["searchAddon"],
    termElement: document.createElement("div"),
    ptyId: 1,
    title: "test",
    hasUnread: false,
    opened: true,
    ...overrides,
  };
}

function makePane(
  surfaces?: TerminalSurface[],
  overrides: Partial<Pane> = {},
): Pane {
  const surfs = surfaces ?? [mockTerminalSurface()];
  return {
    id: uid(),
    surfaces: surfs,
    activeSurfaceId: surfs[0]?.id ?? null,
    ...overrides,
  };
}

function makeWorkspace(
  overrides: Partial<NestedWorkspace> = {},
): NestedWorkspace {
  const pane = makePane();
  return {
    id: uid(),
    name: "NestedWorkspace 1",
    splitRoot: { type: "pane", pane },
    activePaneId: pane.id,
    ...overrides,
  };
}

/**
 * Configure the createTerminalSurface mock to behave like the real function:
 * creates a surface, pushes it onto the pane, and sets activeSurfaceId.
 */
function setupCreateTerminalSurfaceMock(): void {
  vi.mocked(createTerminalSurface).mockImplementation(async (pane: Pane) => {
    const surface = mockTerminalSurface();
    pane.surfaces.push(surface);
    pane.activeSurfaceId = surface.id;
    return surface;
  });
}

// --- Setup / Teardown ---

beforeEach(() => {
  workspaces.set([]);
  activeWorkspaceIdx.set(-1);
  vi.clearAllMocks();
  vi.useFakeTimers();
  setupCreateTerminalSurfaceMock();
});

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================
// 1. NestedWorkspace lifecycle
// ============================================================

describe("Workflow: workspace lifecycle", () => {
  it("creates a workspace, switches to it, then closes it", async () => {
    const existing = makeWorkspace({ name: "Initial" });
    workspaces.set([existing]);
    activeWorkspaceIdx.set(0);

    // Create a new workspace
    await createWorkspace("My Project");

    // Verify it appears in the store
    const wsList = get(workspaces);
    expect(wsList).toHaveLength(2);
    expect(wsList[1].name).toBe("My Project");

    // Verify activeWorkspace switched to the new one
    expect(get(activeWorkspaceIdx)).toBe(1);
    expect(get(activeWorkspace)?.name).toBe("My Project");

    // Switch back to the first workspace
    switchWorkspace(0);
    expect(get(activeWorkspaceIdx)).toBe(0);
    expect(get(activeWorkspace)?.name).toBe("Initial");

    // Switch to new workspace and close it
    switchWorkspace(1);
    expect(get(activeWorkspace)?.name).toBe("My Project");

    closeWorkspace(1);

    // Verify it's removed
    expect(get(workspaces)).toHaveLength(1);
    expect(get(workspaces)[0].name).toBe("Initial");

    // Active workspace should fall back
    expect(get(activeWorkspaceIdx)).toBe(0);
    expect(get(activeWorkspace)?.name).toBe("Initial");
  });

  it("creates a workspace with a pane and terminal surface", async () => {
    await createWorkspace("Dev");

    const ws = get(activeWorkspace);
    expect(ws).not.toBeNull();
    expect(ws!.name).toBe("Dev");

    // The workspace should have one pane with one terminal surface
    const panes = getAllPanes(ws!.splitRoot);
    expect(panes).toHaveLength(1);
    expect(panes[0].surfaces).toHaveLength(1);
    expect(panes[0].surfaces[0].kind).toBe("terminal");

    // createTerminalSurface should have been called
    expect(createTerminalSurface).toHaveBeenCalledOnce();
  });
});

// ============================================================
// 2. Pane split and navigation
// ============================================================

describe("Workflow: pane split and navigation", () => {
  it("splits a pane, navigates between panes, then closes one", async () => {
    // Start with a single-pane workspace
    const ws = makeWorkspace({ name: "Split Test" });
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

    const originalPaneId = ws.activePaneId!;

    // Split the pane horizontally
    await splitPane(originalPaneId, "horizontal");

    // Verify two panes exist
    const currentWs = get(activeWorkspace)!;
    const panes = getAllPanes(currentWs.splitRoot);
    expect(panes).toHaveLength(2);

    // The split root should now be a split node
    expect(currentWs.splitRoot.type).toBe("split");
    if (currentWs.splitRoot.type === "split") {
      expect(currentWs.splitRoot.direction).toBe("horizontal");
    }

    // activePane should be the new pane (splitPane focuses the new pane)
    const newPaneId = currentWs.activePaneId!;
    expect(newPaneId).not.toBe(originalPaneId);
    expect(get(activePane)?.id).toBe(newPaneId);

    // Focus the original pane
    focusPane(originalPaneId);
    expect(get(activePane)?.id).toBe(originalPaneId);

    // Focus back to the new pane
    focusPane(newPaneId);
    expect(get(activePane)?.id).toBe(newPaneId);

    // Close the new pane — should fall back to the original
    closePane(newPaneId);

    const afterClose = get(activeWorkspace)!;
    const remainingPanes = getAllPanes(afterClose.splitRoot);
    expect(remainingPanes).toHaveLength(1);
    expect(remainingPanes[0].id).toBe(originalPaneId);

    // splitRoot should collapse back to a pane node
    expect(afterClose.splitRoot.type).toBe("pane");
  });

  it("splits vertically and verifies direction", async () => {
    const ws = makeWorkspace({ name: "Vertical Split" });
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

    await splitPane(ws.activePaneId!, "vertical");

    const currentWs = get(activeWorkspace)!;
    expect(currentWs.splitRoot.type).toBe("split");
    if (currentWs.splitRoot.type === "split") {
      expect(currentWs.splitRoot.direction).toBe("vertical");
      expect(currentWs.splitRoot.ratio).toBe(0.5);
    }
  });

  it("splitting an inactive pane inherits cwd from the source pane, not the focused pane", async () => {
    // Regression: splitPane used to read cwd from the globally-active
    // surface. When MCP or a command targets a non-focused pane, the new
    // terminal inherited the wrong cwd. Fix routes cwd through the
    // source pane's active surface.
    const paneA = makePane([
      mockTerminalSurface({ cwd: "/src/pane-a", ptyId: 10 }),
    ]);
    const paneB = makePane([
      mockTerminalSurface({ cwd: "/src/pane-b", ptyId: 20 }),
    ]);
    const ws: NestedWorkspace = {
      id: uid(),
      name: "Cwd Source",
      splitRoot: {
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        children: [
          { type: "pane", pane: paneA },
          { type: "pane", pane: paneB },
        ],
      },
      activePaneId: paneB.id, // B is focused
    };
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

    // Split A (the non-focused pane)
    await splitPane(paneA.id, "horizontal");

    // getCwdForSurface should have been called with A's surface, not B's
    expect(getCwdForSurface).toHaveBeenCalledTimes(1);
    const passed = vi.mocked(getCwdForSurface).mock.calls[0][0];
    expect(passed?.id).toBe(paneA.surfaces[0].id);
  });

  it("opening a new tab in an inactive pane inherits cwd from that pane, not the focused pane", async () => {
    // Regression: newSurface read cwd from the globally-active surface.
    // Clicking "+" on a non-focused pane's tab bar leaked the focused
    // pane's cwd into the new terminal. Fix routes cwd through the
    // target pane's active surface.
    const paneA = makePane([
      mockTerminalSurface({ cwd: "/src/pane-a", ptyId: 10 }),
    ]);
    const paneB = makePane([
      mockTerminalSurface({ cwd: "/src/pane-b", ptyId: 20 }),
    ]);
    const ws: NestedWorkspace = {
      id: uid(),
      name: "Cwd Source",
      splitRoot: {
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        children: [
          { type: "pane", pane: paneA },
          { type: "pane", pane: paneB },
        ],
      },
      activePaneId: paneB.id, // B is focused
    };
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

    // Open a new tab in A (the non-focused pane)
    await newSurface(paneA.id);

    // getCwdForSurface should have been called with A's active surface, not B's
    expect(getCwdForSurface).toHaveBeenCalledTimes(1);
    const passed = vi.mocked(getCwdForSurface).mock.calls[0][0];
    expect(passed?.id).toBe(paneA.surfaces[0].id);
  });
});

// ============================================================
// 3. Extension surface lifecycle
// ============================================================

describe("Workflow: extension surface lifecycle", () => {
  beforeEach(() => {
    resetSurfaceTypes();
  });

  it("registers a surface type, opens an extension surface, then closes it", () => {
    // Set up a workspace with a pane
    const ws = makeWorkspace({ name: "Extension Test" });
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

    // Register a custom surface type
    registerSurfaceType({
      id: "test-ext:detail-panel",
      label: "Detail Panel",
      component: "DetailPanel",
      source: "test-ext",
    });

    // Verify registration
    expect(get(surfaceTypeStore)).toHaveLength(1);
    expect(get(surfaceTypeStore)[0].id).toBe("test-ext:detail-panel");

    // Open an extension surface in the active pane
    openExtensionSurfaceInPane("test-ext:detail-panel", "Issue #42", {
      issueId: 42,
      repo: "gnar-term",
    });

    // Verify the surface appears in the pane
    const pane = get(activePane)!;
    // Original terminal surface + new extension surface
    expect(pane.surfaces).toHaveLength(2);

    const extSurface = pane.surfaces[1] as ExtensionSurface;
    expect(extSurface.kind).toBe("extension");
    expect(extSurface.surfaceTypeId).toBe("test-ext:detail-panel");
    expect(extSurface.title).toBe("Issue #42");
    expect(extSurface.props).toEqual({ issueId: 42, repo: "gnar-term" });

    // The extension surface should be the active surface
    expect(pane.activeSurfaceId).toBe(extSurface.id);
    expect(get(activeSurface)?.id).toBe(extSurface.id);

    // Close the extension surface
    closeSurfaceById(pane.id, extSurface.id);

    // Verify it's removed — only the original terminal surface remains
    const updatedPane = get(activePane)!;
    expect(updatedPane.surfaces).toHaveLength(1);
    expect(updatedPane.surfaces[0].kind).toBe("terminal");

    // Active surface should fall back to the terminal
    expect(updatedPane.activeSurfaceId).toBe(updatedPane.surfaces[0].id);
  });

  it("opens multiple extension surfaces and closes one in the middle", () => {
    const ws = makeWorkspace({ name: "Multi Surface" });
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

    registerSurfaceType({
      id: "notes:editor",
      label: "Note Editor",
      component: "NoteEditor",
      source: "notes-ext",
    });

    // Open two extension surfaces
    openExtensionSurfaceInPane("notes:editor", "Note A", { noteId: "a" });
    openExtensionSurfaceInPane("notes:editor", "Note B", { noteId: "b" });

    const pane = get(activePane)!;
    // 1 terminal + 2 extension surfaces
    expect(pane.surfaces).toHaveLength(3);

    // Close the first extension surface (index 1)
    const noteA = pane.surfaces[1];
    closeSurfaceById(pane.id, noteA.id);

    const updated = get(activePane)!;
    expect(updated.surfaces).toHaveLength(2);
    expect(updated.surfaces[0].kind).toBe("terminal");
    expect((updated.surfaces[1] as ExtensionSurface).title).toBe("Note B");
  });

  it("closing the last surface closes the workspace (matches pty-exit path)", () => {
    // Closing the last surface in a workspace's only pane closes the
    // whole workspace — same behavior as terminal-service.ts's
    // pty-exit handler. App.svelte renders EmptySurface when the
    // workspace list is empty.
    const ws = makeWorkspace({ name: "Lonely" });
    const otherWs = makeWorkspace({ name: "Other" });
    workspaces.set([ws, otherWs]);
    activeWorkspaceIdx.set(0);

    const pane = get(activePane)!;
    const surface = pane.surfaces[0]!;
    closeSurfaceById(pane.id, surface.id);

    const list = get(workspaces);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(otherWs.id);
  });
});

// ============================================================
// 4. Multi-workspace switching
// ============================================================

describe("Workflow: multi-workspace switching", () => {
  it("creates 3 workspaces, switches between them, closes one", async () => {
    // Create 3 workspaces
    await createWorkspace("Project A");
    await createWorkspace("Project B");
    await createWorkspace("Project C");

    expect(get(workspaces)).toHaveLength(3);
    expect(get(workspaces).map((ws) => ws.name)).toEqual([
      "Project A",
      "Project B",
      "Project C",
    ]);

    // Active workspace should be the last created
    expect(get(activeWorkspaceIdx)).toBe(2);
    expect(get(activeWorkspace)?.name).toBe("Project C");

    // Switch to first workspace
    switchWorkspace(0);
    expect(get(activeWorkspace)?.name).toBe("Project A");

    // Switch to second
    switchWorkspace(1);
    expect(get(activeWorkspace)?.name).toBe("Project B");

    // Switch to third
    switchWorkspace(2);
    expect(get(activeWorkspace)?.name).toBe("Project C");

    // Close the middle workspace (Project B, index 1)
    // First, need to be viewing something other than what gets deleted.
    switchWorkspace(0);
    closeWorkspace(1);

    // Verify remaining workspaces
    const remaining = get(workspaces);
    expect(remaining).toHaveLength(2);
    expect(remaining.map((ws) => ws.name)).toEqual(["Project A", "Project C"]);

    // Active workspace index should adjust
    expect(get(activeWorkspaceIdx)).toBe(0);
    expect(get(activeWorkspace)?.name).toBe("Project A");

    // Can still switch to the remaining workspaces
    switchWorkspace(1);
    expect(get(activeWorkspace)?.name).toBe("Project C");

    switchWorkspace(0);
    expect(get(activeWorkspace)?.name).toBe("Project A");
  });

  it("closing the last active workspace falls back to the previous", async () => {
    await createWorkspace("WS 1");
    await createWorkspace("WS 2");
    await createWorkspace("WS 3");

    // Active is WS 3 (index 2)
    expect(get(activeWorkspace)?.name).toBe("WS 3");

    // Close the active workspace (last one)
    closeWorkspace(2);

    expect(get(workspaces)).toHaveLength(2);
    // Should fall back to the last valid index
    expect(get(activeWorkspaceIdx)).toBe(1);
    expect(get(activeWorkspace)?.name).toBe("WS 2");
  });

  it("each workspace maintains independent pane state", async () => {
    await createWorkspace("Editor");
    await createWorkspace("Terminal");

    // Split pane in the second workspace (Terminal)
    const termWs = get(activeWorkspace)!;
    const termPaneId = termWs.activePaneId!;
    await splitPane(termPaneId, "horizontal");

    // Terminal workspace should now have 2 panes
    expect(getAllPanes(get(activeWorkspace)!.splitRoot)).toHaveLength(2);

    // Switch to Editor workspace — it should still have 1 pane
    switchWorkspace(0);
    expect(getAllPanes(get(activeWorkspace)!.splitRoot)).toHaveLength(1);

    // Switch back to Terminal — still has 2 panes
    switchWorkspace(1);
    expect(getAllPanes(get(activeWorkspace)!.splitRoot)).toHaveLength(2);
  });
});
