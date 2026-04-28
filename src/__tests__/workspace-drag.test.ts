/**
 * Tests for sidebar tab-drop services:
 *   - createWorkspaceFromSurface  → spawn a new workspace with the surface
 *   - moveSurfaceToWorkspace      → move the surface into an existing workspace
 *
 * Both move the surface out of its source pane (collapsing the pane
 * if it empties) and persist. createWorkspaceFromSurface inherits the
 * source workspace's groupId, refuses to leave the source empty, and
 * registers the new workspace via appendRootRow + addWorkspaceToGroup
 * (when the source belongs to a group).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { get } from "svelte/store";

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
  getState: vi.fn().mockReturnValue({ rootRowOrder: [] }),
}));

vi.mock("../lib/services/service-helpers", () => ({
  safeFocus: vi.fn(),
  getActiveCwd: vi.fn().mockResolvedValue(undefined),
  getCwdForSurface: vi.fn().mockResolvedValue(undefined),
}));

const appendRootRowSpy = vi.fn();
const removeRootRowSpy = vi.fn();
vi.mock("../lib/stores/root-row-order", async () => {
  const actual = await vi.importActual<
    typeof import("../lib/stores/root-row-order")
  >("../lib/stores/root-row-order");
  return {
    ...actual,
    appendRootRow: (...args: Parameters<typeof actual.appendRootRow>) => {
      appendRootRowSpy(...args);
      return actual.appendRootRow(...args);
    },
    removeRootRow: (...args: Parameters<typeof actual.removeRootRow>) => {
      removeRootRowSpy(...args);
      return actual.removeRootRow(...args);
    },
  };
});

const addWorkspaceToGroupSpy = vi.fn().mockReturnValue(true);
const removeWorkspaceFromAllGroupsSpy = vi.fn();
vi.mock("../lib/services/workspace-group-service", async () => {
  const actual = await vi.importActual<
    typeof import("../lib/services/workspace-group-service")
  >("../lib/services/workspace-group-service");
  return {
    ...actual,
    addWorkspaceToGroup: (
      ...args: Parameters<typeof actual.addWorkspaceToGroup>
    ) => addWorkspaceToGroupSpy(...args),
    removeWorkspaceFromAllGroups: (
      ...args: Parameters<typeof actual.removeWorkspaceFromAllGroups>
    ) => removeWorkspaceFromAllGroupsSpy(...args),
  };
});

const gitStatusWorkspaceClosedSpy = vi.fn();
vi.mock("../lib/services/git-status-service", () => ({
  handleWorkspaceClosed: (...args: unknown[]) =>
    gitStatusWorkspaceClosedSpy(...args),
  GIT_STATUS_SOURCE: "git",
  stopPolling: vi.fn(),
  clearAllStatusForSourceAndWorkspace: vi.fn(),
}));

import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import {
  uid,
  getAllPanes,
  type Workspace,
  type Pane,
  type SplitNode,
  type TerminalSurface,
} from "../lib/types";
import { createWorkspaceFromSurface } from "../lib/services/workspace-service";
import {
  moveSurfaceToWorkspace,
  expandWorkspaceIntoPanes,
  mergeWorkspaceIntoPane,
} from "../lib/services/pane-service";
import { saveState } from "../lib/config";

function mockSurface(
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

function makePane(surfaces: TerminalSurface[]): Pane {
  return {
    id: uid(),
    surfaces,
    activeSurfaceId: surfaces[0]?.id ?? null,
  };
}

function makeWorkspace(
  splitRoot: SplitNode,
  overrides: Partial<Workspace> = {},
): Workspace {
  return {
    id: uid(),
    name: "WS",
    splitRoot,
    activePaneId: getAllPanes(splitRoot)[0]?.id ?? null,
    ...overrides,
  };
}

beforeEach(() => {
  workspaces.set([]);
  activeWorkspaceIdx.set(-1);
  vi.clearAllMocks();
  appendRootRowSpy.mockClear();
  removeRootRowSpy.mockClear();
  addWorkspaceToGroupSpy.mockClear();
  removeWorkspaceFromAllGroupsSpy.mockClear();
  gitStatusWorkspaceClosedSpy.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createWorkspaceFromSurface", () => {
  it("creates a new workspace containing the dragged surface", () => {
    const sA = mockSurface({ title: "A" });
    const sB = mockSurface({ title: "B" });
    const pane = makePane([sA, sB]);
    const ws = makeWorkspace({ type: "pane", pane });
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

    createWorkspaceFromSurface(sA.id, pane.id, ws.id);

    const updated = get(workspaces);
    expect(updated.length).toBe(2);
    const newWs = updated[1]!;
    expect(getAllPanes(newWs.splitRoot).flatMap((p) => p.surfaces)).toEqual([
      sA,
    ]);
    // Source pane keeps surviving surface.
    expect(pane.surfaces.map((s) => s.id)).toEqual([sB.id]);
  });

  it("inherits groupId from source when present", () => {
    const sA = mockSurface({ title: "A" });
    const sB = mockSurface({ title: "B" });
    const pane = makePane([sA, sB]);
    const ws = makeWorkspace(
      { type: "pane", pane },
      { metadata: { groupId: "group-1" } },
    );
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

    createWorkspaceFromSurface(sA.id, pane.id, ws.id);

    const updated = get(workspaces);
    const newWs = updated[1]!;
    expect((newWs.metadata as Record<string, unknown>)?.groupId).toBe(
      "group-1",
    );
    expect(addWorkspaceToGroupSpy).toHaveBeenCalledWith("group-1", newWs.id);
  });

  it("leaves new workspace ungrouped when source has no groupId", () => {
    const sA = mockSurface({ title: "A" });
    const sB = mockSurface({ title: "B" });
    const pane = makePane([sA, sB]);
    const ws = makeWorkspace({ type: "pane", pane });
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

    createWorkspaceFromSurface(sA.id, pane.id, ws.id);

    const updated = get(workspaces);
    const newWs = updated[1]!;
    expect(
      (newWs.metadata as Record<string, unknown>)?.groupId,
    ).toBeUndefined();
    expect(addWorkspaceToGroupSpy).not.toHaveBeenCalled();
  });

  it("is a no-op when source workspace has only 1 surface (guard)", () => {
    const sA = mockSurface({ title: "A" });
    const pane = makePane([sA]);
    const ws = makeWorkspace({ type: "pane", pane });
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

    createWorkspaceFromSurface(sA.id, pane.id, ws.id);

    const updated = get(workspaces);
    expect(updated.length).toBe(1);
    expect(pane.surfaces.length).toBe(1);
  });

  it("collapses the source pane when its last surface moves out", () => {
    // Source workspace has two panes (so pulling sA from sourcePane
    // doesn't trigger the >1-surface guard, but does empty sourcePane).
    const sA = mockSurface({ title: "A" });
    const sB = mockSurface({ title: "B" });
    const sourcePane = makePane([sA]);
    const otherPane = makePane([sB]);
    const root: SplitNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { type: "pane", pane: sourcePane },
        { type: "pane", pane: otherPane },
      ],
    };
    const ws = makeWorkspace(root);
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

    createWorkspaceFromSurface(sA.id, sourcePane.id, ws.id);

    // Source workspace's split collapses — only otherPane remains.
    const updated = get(workspaces);
    const srcUpdated = updated.find((w) => w.id === ws.id)!;
    const srcPanes = getAllPanes(srcUpdated.splitRoot);
    expect(srcPanes.length).toBe(1);
    expect(srcPanes[0]!.id).toBe(otherPane.id);
  });

  it("calls appendRootRow with the new workspace id", () => {
    const sA = mockSurface({ title: "A" });
    const sB = mockSurface({ title: "B" });
    const pane = makePane([sA, sB]);
    const ws = makeWorkspace({ type: "pane", pane });
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

    createWorkspaceFromSurface(sA.id, pane.id, ws.id);

    const updated = get(workspaces);
    const newWs = updated[1]!;
    expect(appendRootRowSpy).toHaveBeenCalledWith({
      kind: "workspace",
      id: newWs.id,
    });
  });

  it("schedules a persist", () => {
    const sA = mockSurface({ title: "A" });
    const sB = mockSurface({ title: "B" });
    const pane = makePane([sA, sB]);
    const ws = makeWorkspace({ type: "pane", pane });
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

    createWorkspaceFromSurface(sA.id, pane.id, ws.id);
    vi.advanceTimersByTime(2000);
    expect(saveState).toHaveBeenCalled();
  });
});

describe("moveSurfaceToWorkspace", () => {
  it("removes the surface from its source pane and adds it to target's active pane", () => {
    const sA = mockSurface({ title: "A" });
    const sB = mockSurface({ title: "B" });
    const sC = mockSurface({ title: "C" });
    const sourcePane = makePane([sA, sB]);
    const targetPane = makePane([sC]);
    const sourceWs = makeWorkspace({ type: "pane", pane: sourcePane });
    const targetWs = makeWorkspace({ type: "pane", pane: targetPane });
    workspaces.set([sourceWs, targetWs]);
    activeWorkspaceIdx.set(0);

    moveSurfaceToWorkspace(sA.id, sourcePane.id, targetWs.id);

    expect(sourcePane.surfaces.map((s) => s.id)).toEqual([sB.id]);
    expect(targetPane.surfaces.map((s) => s.id)).toEqual([sC.id, sA.id]);
    expect(targetPane.activeSurfaceId).toBe(sA.id);
  });

  it("collapses the source pane when its last surface moves out", () => {
    const sA = mockSurface({ title: "A" });
    const sB = mockSurface({ title: "B" });
    const sC = mockSurface({ title: "C" });
    // Source workspace has two panes — sourcePane has only sA, so
    // moving sA out empties it and the split should collapse.
    const sourcePane = makePane([sA]);
    const otherPane = makePane([sB]);
    const sourceRoot: SplitNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { type: "pane", pane: sourcePane },
        { type: "pane", pane: otherPane },
      ],
    };
    const sourceWs = makeWorkspace(sourceRoot);
    const targetPane = makePane([sC]);
    const targetWs = makeWorkspace({ type: "pane", pane: targetPane });
    workspaces.set([sourceWs, targetWs]);
    activeWorkspaceIdx.set(0);

    moveSurfaceToWorkspace(sA.id, sourcePane.id, targetWs.id);

    const updatedSrc = get(workspaces).find((w) => w.id === sourceWs.id)!;
    expect(getAllPanes(updatedSrc.splitRoot).length).toBe(1);
    expect(getAllPanes(updatedSrc.splitRoot)[0]!.id).toBe(otherPane.id);
  });

  it("schedules a persist", () => {
    const sA = mockSurface({ title: "A" });
    const sB = mockSurface({ title: "B" });
    const sC = mockSurface({ title: "C" });
    const sourcePane = makePane([sA, sB]);
    const targetPane = makePane([sC]);
    const sourceWs = makeWorkspace({ type: "pane", pane: sourcePane });
    const targetWs = makeWorkspace({ type: "pane", pane: targetPane });
    workspaces.set([sourceWs, targetWs]);
    activeWorkspaceIdx.set(0);

    moveSurfaceToWorkspace(sA.id, sourcePane.id, targetWs.id);
    vi.advanceTimersByTime(2000);
    expect(saveState).toHaveBeenCalled();
  });
});

describe("expandWorkspaceIntoPanes", () => {
  it("each surface of source workspace becomes its own pane in target workspace", () => {
    const sA = mockSurface({ title: "A" });
    const sB = mockSurface({ title: "B" });
    const sC = mockSurface({ title: "C" });
    const srcPane = makePane([sA, sB]);
    const tgtPane = makePane([sC]);
    const srcWs = makeWorkspace({ type: "pane", pane: srcPane });
    const tgtWs = makeWorkspace({ type: "pane", pane: tgtPane });
    workspaces.set([srcWs, tgtWs]);
    activeWorkspaceIdx.set(1);

    expandWorkspaceIntoPanes(srcWs.id, tgtPane.id, "horizontal", false);

    const updated = get(workspaces);
    // Source workspace removed
    expect(updated.find((w) => w.id === srcWs.id)).toBeUndefined();
    // Target workspace now has 3 panes: original + one per source surface
    const tgtPanes = getAllPanes(tgtWs.splitRoot);
    expect(tgtPanes.length).toBe(3);
    // Original target pane is still present
    expect(tgtPanes.some((p) => p.id === tgtPane.id)).toBe(true);
    // Each source surface lives in its own pane
    const allSurfaces = tgtPanes.flatMap((p) => p.surfaces);
    expect(allSurfaces.map((s) => s.id)).toContain(sA.id);
    expect(allSurfaces.map((s) => s.id)).toContain(sB.id);
    expect(allSurfaces.every((s) => s !== undefined)).toBe(true);
    // Each pane has exactly one surface
    expect(tgtPanes.every((p) => p.surfaces.length === 1)).toBe(true);
  });

  it("source workspace is removed from the workspaces store", () => {
    const sA = mockSurface({ title: "A" });
    const sB = mockSurface({ title: "B" });
    const srcPane = makePane([sA]);
    const tgtPane = makePane([sB]);
    const srcWs = makeWorkspace({ type: "pane", pane: srcPane });
    const tgtWs = makeWorkspace({ type: "pane", pane: tgtPane });
    workspaces.set([srcWs, tgtWs]);
    activeWorkspaceIdx.set(0);

    expandWorkspaceIntoPanes(srcWs.id, tgtPane.id, "horizontal", false);

    expect(get(workspaces).find((w) => w.id === srcWs.id)).toBeUndefined();
    expect(get(workspaces).find((w) => w.id === tgtWs.id)).toBeDefined();
  });

  it("calls removeRootRow for the source workspace", () => {
    const sA = mockSurface({ title: "A" });
    const sB = mockSurface({ title: "B" });
    const srcPane = makePane([sA]);
    const tgtPane = makePane([sB]);
    const srcWs = makeWorkspace({ type: "pane", pane: srcPane });
    const tgtWs = makeWorkspace({ type: "pane", pane: tgtPane });
    workspaces.set([srcWs, tgtWs]);
    activeWorkspaceIdx.set(0);

    expandWorkspaceIntoPanes(srcWs.id, tgtPane.id, "horizontal", false);

    expect(removeRootRowSpy).toHaveBeenCalledWith({
      kind: "workspace",
      id: srcWs.id,
    });
  });

  it("calls removeWorkspaceFromAllGroups for the source workspace", () => {
    const sA = mockSurface({ title: "A" });
    const sB = mockSurface({ title: "B" });
    const srcPane = makePane([sA]);
    const tgtPane = makePane([sB]);
    const srcWs = makeWorkspace({ type: "pane", pane: srcPane });
    const tgtWs = makeWorkspace({ type: "pane", pane: tgtPane });
    workspaces.set([srcWs, tgtWs]);
    activeWorkspaceIdx.set(0);

    expandWorkspaceIntoPanes(srcWs.id, tgtPane.id, "horizontal", false);

    expect(removeWorkspaceFromAllGroupsSpy).toHaveBeenCalledWith(srcWs.id);
  });

  it("does not call dispose on moved terminals", () => {
    const sA = mockSurface({ title: "A" });
    const sB = mockSurface({ title: "B" });
    const srcPane = makePane([sA]);
    const tgtPane = makePane([sB]);
    const srcWs = makeWorkspace({ type: "pane", pane: srcPane });
    const tgtWs = makeWorkspace({ type: "pane", pane: tgtPane });
    workspaces.set([srcWs, tgtWs]);
    activeWorkspaceIdx.set(0);

    expandWorkspaceIntoPanes(srcWs.id, tgtPane.id, "horizontal", false);

    expect(sA.terminal.dispose).not.toHaveBeenCalled();
  });

  it("splits 'before' when before=true (left/top zone)", () => {
    const sA = mockSurface({ title: "A" });
    const sB = mockSurface({ title: "B" });
    const srcPane = makePane([sA]);
    const tgtPane = makePane([sB]);
    const srcWs = makeWorkspace({ type: "pane", pane: srcPane });
    const tgtWs = makeWorkspace({ type: "pane", pane: tgtPane });
    workspaces.set([srcWs, tgtWs]);
    activeWorkspaceIdx.set(0);

    expandWorkspaceIntoPanes(srcWs.id, tgtPane.id, "horizontal", true);

    // With before=true: new pane is the left child, target pane is the right child
    const root = tgtWs.splitRoot;
    expect(root.type).toBe("split");
    if (root.type === "split") {
      // The new pane (with sA) should be at index 0 (before=true → left child)
      const leftPane =
        root.children[0]!.type === "pane" ? root.children[0]!.pane : null;
      expect(leftPane?.surfaces[0]?.id).toBe(sA.id);
      const rightPane =
        root.children[1]!.type === "pane" ? root.children[1]!.pane : null;
      expect(rightPane?.id).toBe(tgtPane.id);
    }
  });

  it("is a no-op when source and target are the same workspace", () => {
    const sA = mockSurface({ title: "A" });
    const sB = mockSurface({ title: "B" });
    const pane = makePane([sA, sB]);
    const ws = makeWorkspace({ type: "pane", pane });
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

    expandWorkspaceIntoPanes(ws.id, pane.id, "horizontal", false);

    expect(get(workspaces).length).toBe(1);
  });

  it("is a no-op when target pane is not found in any workspace", () => {
    const sA = mockSurface({ title: "A" });
    const sB = mockSurface({ title: "B" });
    const srcPane = makePane([sA]);
    const tgtPane = makePane([sB]);
    const srcWs = makeWorkspace({ type: "pane", pane: srcPane });
    const tgtWs = makeWorkspace({ type: "pane", pane: tgtPane });
    workspaces.set([srcWs, tgtWs]);
    activeWorkspaceIdx.set(0);

    expandWorkspaceIntoPanes(
      srcWs.id,
      "nonexistent-pane-id",
      "horizontal",
      false,
    );

    expect(get(workspaces).length).toBe(2);
  });

  it("schedules a persist", () => {
    const sA = mockSurface({ title: "A" });
    const sB = mockSurface({ title: "B" });
    const srcPane = makePane([sA]);
    const tgtPane = makePane([sB]);
    const srcWs = makeWorkspace({ type: "pane", pane: srcPane });
    const tgtWs = makeWorkspace({ type: "pane", pane: tgtPane });
    workspaces.set([srcWs, tgtWs]);
    activeWorkspaceIdx.set(0);

    expandWorkspaceIntoPanes(srcWs.id, tgtPane.id, "horizontal", false);
    vi.advanceTimersByTime(2000);
    expect(saveState).toHaveBeenCalled();
  });

  it("sets active pane to last-created pane after expansion", () => {
    const sA = mockSurface({ title: "A" });
    const sB = mockSurface({ title: "B" });
    const sC = mockSurface({ title: "C" });
    const srcPane = makePane([sA, sB]);
    const tgtPane = makePane([sC]);
    const srcWs = makeWorkspace({ type: "pane", pane: srcPane });
    const tgtWs = makeWorkspace({ type: "pane", pane: tgtPane });
    workspaces.set([srcWs, tgtWs]);
    activeWorkspaceIdx.set(1);

    expandWorkspaceIntoPanes(srcWs.id, tgtPane.id, "horizontal", false);

    // activePaneId should point to the last newly-created pane (sB's pane)
    const tgtPanes = getAllPanes(tgtWs.splitRoot);
    const activePaneId = tgtWs.activePaneId;
    const activePane = tgtPanes.find((p) => p.id === activePaneId);
    expect(activePane).toBeDefined();
    expect(activePane?.surfaces[0]?.id).toBe(sB.id);
  });
});

describe("mergeWorkspaceIntoPane", () => {
  it("appends all source surfaces to the target pane", () => {
    const sA = mockSurface({ title: "A" });
    const sB = mockSurface({ title: "B" });
    const sC = mockSurface({ title: "C" });
    const srcPane = makePane([sA, sB]);
    const tgtPane = makePane([sC]);
    const srcWs = makeWorkspace({ type: "pane", pane: srcPane });
    const tgtWs = makeWorkspace({ type: "pane", pane: tgtPane });
    workspaces.set([srcWs, tgtWs]);
    activeWorkspaceIdx.set(1);

    mergeWorkspaceIntoPane(srcWs.id, tgtPane.id);

    expect(tgtPane.surfaces.map((s) => s.id)).toEqual([sC.id, sA.id, sB.id]);
  });

  it("sets activeSurfaceId to the last appended surface", () => {
    const sA = mockSurface({ title: "A" });
    const sB = mockSurface({ title: "B" });
    const sC = mockSurface({ title: "C" });
    const srcPane = makePane([sA, sB]);
    const tgtPane = makePane([sC]);
    const srcWs = makeWorkspace({ type: "pane", pane: srcPane });
    const tgtWs = makeWorkspace({ type: "pane", pane: tgtPane });
    workspaces.set([srcWs, tgtWs]);
    activeWorkspaceIdx.set(1);

    mergeWorkspaceIntoPane(srcWs.id, tgtPane.id);

    expect(tgtPane.activeSurfaceId).toBe(sB.id);
  });

  it("sets activePaneId on the target workspace to targetPane", () => {
    const sA = mockSurface({ title: "A" });
    const sB = mockSurface({ title: "B" });
    const srcPane = makePane([sA]);
    const tgtPane = makePane([sB]);
    const srcWs = makeWorkspace({ type: "pane", pane: srcPane });
    const tgtWs = makeWorkspace({ type: "pane", pane: tgtPane });
    workspaces.set([srcWs, tgtWs]);
    activeWorkspaceIdx.set(1);

    mergeWorkspaceIntoPane(srcWs.id, tgtPane.id);

    expect(tgtWs.activePaneId).toBe(tgtPane.id);
  });

  it("removes the source workspace from the workspaces store", () => {
    const sA = mockSurface({ title: "A" });
    const sB = mockSurface({ title: "B" });
    const srcPane = makePane([sA]);
    const tgtPane = makePane([sB]);
    const srcWs = makeWorkspace({ type: "pane", pane: srcPane });
    const tgtWs = makeWorkspace({ type: "pane", pane: tgtPane });
    workspaces.set([srcWs, tgtWs]);
    activeWorkspaceIdx.set(1);

    mergeWorkspaceIntoPane(srcWs.id, tgtPane.id);

    expect(get(workspaces).find((w) => w.id === srcWs.id)).toBeUndefined();
    expect(get(workspaces).find((w) => w.id === tgtWs.id)).toBeDefined();
  });

  it("calls removeRootRow for the source workspace", () => {
    const sA = mockSurface({ title: "A" });
    const sB = mockSurface({ title: "B" });
    const srcPane = makePane([sA]);
    const tgtPane = makePane([sB]);
    const srcWs = makeWorkspace({ type: "pane", pane: srcPane });
    const tgtWs = makeWorkspace({ type: "pane", pane: tgtPane });
    workspaces.set([srcWs, tgtWs]);
    activeWorkspaceIdx.set(1);

    mergeWorkspaceIntoPane(srcWs.id, tgtPane.id);

    expect(removeRootRowSpy).toHaveBeenCalledWith({
      kind: "workspace",
      id: srcWs.id,
    });
  });

  it("calls removeWorkspaceFromAllGroups for the source workspace", () => {
    const sA = mockSurface({ title: "A" });
    const sB = mockSurface({ title: "B" });
    const srcPane = makePane([sA]);
    const tgtPane = makePane([sB]);
    const srcWs = makeWorkspace({ type: "pane", pane: srcPane });
    const tgtWs = makeWorkspace({ type: "pane", pane: tgtPane });
    workspaces.set([srcWs, tgtWs]);
    activeWorkspaceIdx.set(1);

    mergeWorkspaceIntoPane(srcWs.id, tgtPane.id);

    expect(removeWorkspaceFromAllGroupsSpy).toHaveBeenCalledWith(srcWs.id);
  });

  it("does not dispose terminals — surfaces move live", () => {
    const sA = mockSurface({ title: "A" });
    const sB = mockSurface({ title: "B" });
    const srcPane = makePane([sA]);
    const tgtPane = makePane([sB]);
    const srcWs = makeWorkspace({ type: "pane", pane: srcPane });
    const tgtWs = makeWorkspace({ type: "pane", pane: tgtPane });
    workspaces.set([srcWs, tgtWs]);
    activeWorkspaceIdx.set(1);

    mergeWorkspaceIntoPane(srcWs.id, tgtPane.id);

    expect(sA.terminal.dispose).not.toHaveBeenCalled();
  });

  it("is a no-op when src and target are the same workspace", () => {
    const sA = mockSurface({ title: "A" });
    const sB = mockSurface({ title: "B" });
    const pane = makePane([sA, sB]);
    const ws = makeWorkspace({ type: "pane", pane });
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

    mergeWorkspaceIntoPane(ws.id, pane.id);

    expect(get(workspaces).length).toBe(1);
    expect(pane.surfaces.length).toBe(2);
  });

  it("flattens surfaces from a multi-pane source workspace", () => {
    const sA = mockSurface({ title: "A" });
    const sB = mockSurface({ title: "B" });
    const sC = mockSurface({ title: "C" });
    const srcPane1 = makePane([sA]);
    const srcPane2 = makePane([sB]);
    const srcRoot: SplitNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { type: "pane", pane: srcPane1 },
        { type: "pane", pane: srcPane2 },
      ],
    };
    const srcWs = makeWorkspace(srcRoot);
    const tgtPane = makePane([sC]);
    const tgtWs = makeWorkspace({ type: "pane", pane: tgtPane });
    workspaces.set([srcWs, tgtWs]);
    activeWorkspaceIdx.set(1);

    mergeWorkspaceIntoPane(srcWs.id, tgtPane.id);

    expect(tgtPane.surfaces.map((s) => s.id)).toEqual([sC.id, sA.id, sB.id]);
    expect(get(workspaces).length).toBe(1);
  });

  it("schedules a persist", () => {
    const sA = mockSurface({ title: "A" });
    const sB = mockSurface({ title: "B" });
    const srcPane = makePane([sA]);
    const tgtPane = makePane([sB]);
    const srcWs = makeWorkspace({ type: "pane", pane: srcPane });
    const tgtWs = makeWorkspace({ type: "pane", pane: tgtPane });
    workspaces.set([srcWs, tgtWs]);
    activeWorkspaceIdx.set(1);

    mergeWorkspaceIntoPane(srcWs.id, tgtPane.id);
    vi.advanceTimersByTime(2000);
    expect(saveState).toHaveBeenCalled();
  });
});
