/**
 * Tests for sidebar tab-drop services:
 *   - moveSurfaceToWorkspace → move the surface into an existing workspace
 *
 * Moves the surface out of its source pane (collapsing the pane if it
 * empties) and persists.
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

vi.mock("../lib/stores/root-row-order", async () => {
  const actual = await vi.importActual<
    typeof import("../lib/stores/root-row-order")
  >("../lib/stores/root-row-order");
  return { ...actual };
});

import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import {
  uid,
  getAllPanes,
  type Workspace,
  type Pane,
  type SplitNode,
  type TerminalSurface,
} from "../lib/types";
import { moveSurfaceToWorkspace } from "../lib/services/pane-service";
import { saveState } from "../lib/config";

function mockSurface(
  overrides: Partial<TerminalSurface> = {},
): TerminalSurface {
  return {
    kind: "terminal",
    id: uid(),
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

function makeChildWorkspace(
  paneLayout: SplitNode,
  overrides: Partial<Workspace> = {},
): Workspace {
  return {
    id: uid(),
    name: "WS",
    paneLayout,
    activePaneId: getAllPanes(paneLayout)[0]?.id ?? null,
    ...overrides,
  };
}

beforeEach(() => {
  workspaces.set([]);
  activeWorkspaceIdx.set(-1);
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("moveSurfaceToWorkspace", () => {
  it("removes the surface from its source pane and adds it to target's active pane", () => {
    const sA = mockSurface({ title: "A" });
    const sB = mockSurface({ title: "B" });
    const sC = mockSurface({ title: "C" });
    const sourcePane = makePane([sA, sB]);
    const targetPane = makePane([sC]);
    const sourceWs = makeChildWorkspace({ type: "pane", pane: sourcePane });
    const targetWs = makeChildWorkspace({ type: "pane", pane: targetPane });
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
    const sourceWs = makeChildWorkspace(sourceRoot);
    const targetPane = makePane([sC]);
    const targetWs = makeChildWorkspace({ type: "pane", pane: targetPane });
    workspaces.set([sourceWs, targetWs]);
    activeWorkspaceIdx.set(0);

    moveSurfaceToWorkspace(sA.id, sourcePane.id, targetWs.id);

    const updatedSrc = get(workspaces).find((w) => w.id === sourceWs.id)!;
    expect(getAllPanes(updatedSrc.paneLayout).length).toBe(1);
    expect(getAllPanes(updatedSrc.paneLayout)[0]!.id).toBe(otherPane.id);
  });

  it("schedules a persist", () => {
    const sA = mockSurface({ title: "A" });
    const sB = mockSurface({ title: "B" });
    const sC = mockSurface({ title: "C" });
    const sourcePane = makePane([sA, sB]);
    const targetPane = makePane([sC]);
    const sourceWs = makeChildWorkspace({ type: "pane", pane: sourcePane });
    const targetWs = makeChildWorkspace({ type: "pane", pane: targetPane });
    workspaces.set([sourceWs, targetWs]);
    activeWorkspaceIdx.set(0);

    moveSurfaceToWorkspace(sA.id, sourcePane.id, targetWs.id);
    vi.advanceTimersByTime(2000);
    expect(saveState).toHaveBeenCalled();
  });
});
