/**
 * Tests for the tab-drag service — the custom mouse-event drag state
 * machine that replaces HTML5 DnD inside tab bars (Tauri WKWebView's
 * HTML5 DnD is unreliable, mirroring drag-reorder.ts).
 *
 * The service exposes startTabDrag / commitTabDrop / cancelTabDrag plus
 * a `tabDragState` readable. We test:
 *   - the >5px threshold gate
 *   - cancelTabDrag clears state
 *   - commitTabDrop wires the dropTarget kinds to the right service call
 *
 * commitTabDrop's reorder branch must pass `insertIdx` directly to
 * reorderTab (the underlying service already handles the splice
 * adjustment internally — pre-adjusting here would double-count and the
 * drag would no-op).
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

// Spy on pane-service functions so we can verify args without
// running real mutations.
const reorderTabSpy = vi.fn();
const splitPaneWithSurfaceSpy = vi.fn();
const mergeTabToPaneSpy = vi.fn();
const createWorkspaceFromSurfaceSpy = vi.fn();

vi.mock("../lib/services/workspace-service", () => ({
  createNestedWorkspaceFromSurface: (...args: unknown[]) =>
    createWorkspaceFromSurfaceSpy(...args),
}));

vi.mock("../lib/stores/workspace-groups", () => ({
  getWorkspaces: vi.fn().mockReturnValue([]),
  workspacesStore: { subscribe: vi.fn() },
  setActiveWorkspaceId: vi.fn(),
}));

vi.mock("../lib/stores/root-row-order", () => ({
  rootRowOrder: { subscribe: vi.fn(), set: vi.fn() },
  appendRootRow: vi.fn(),
  insertRootRow: vi.fn(),
  removeRootRow: vi.fn(),
  moveRootRow: vi.fn(),
  setRootRowOrder: vi.fn(),
  prependRootRow: vi.fn(),
  bootstrapRootRowOrder: vi.fn(),
  rootRows: { subscribe: vi.fn() },
  get: vi.fn().mockReturnValue([]),
}));

vi.mock("../lib/services/pane-service", async () => {
  const actual = await vi.importActual<
    typeof import("../lib/services/pane-service")
  >("../lib/services/pane-service");
  return {
    ...actual,
    reorderTab: (...args: Parameters<typeof actual.reorderTab>) =>
      reorderTabSpy(...args),
    splitPaneWithSurface: (
      ...args: Parameters<typeof actual.splitPaneWithSurface>
    ) => splitPaneWithSurfaceSpy(...args),
    mergeTabToPane: (...args: Parameters<typeof actual.mergeTabToPane>) =>
      mergeTabToPaneSpy(...args),
  };
});

import {
  nestedWorkspaces,
  activeNestedWorkspaceIdx,
} from "../lib/stores/workspace";
import { getWorkspaces } from "../lib/stores/workspace-groups";
import {
  uid,
  type NestedWorkspace,
  type Pane,
  type TerminalSurface,
} from "../lib/types";
import {
  startTabDrag,
  cancelTabDrag,
  commitTabDrop,
  tabDragState,
  __setTabDropTargetForTest,
} from "../lib/services/tab-drag";

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

function makePane(surfaces: TerminalSurface[]): Pane {
  return {
    id: uid(),
    surfaces,
    activeSurfaceId: surfaces[0]?.id ?? null,
  };
}

function makeWorkspace(pane: Pane): NestedWorkspace {
  return {
    id: uid(),
    name: "WS",
    splitRoot: { type: "pane", pane },
    activePaneId: pane.id,
  };
}

function mouseEvent(
  type: string,
  opts: { clientX?: number; clientY?: number; button?: number } = {},
): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    button: opts.button ?? 0,
  });
}

beforeEach(() => {
  nestedWorkspaces.set([]);
  activeNestedWorkspaceIdx.set(-1);
  reorderTabSpy.mockReset();
  splitPaneWithSurfaceSpy.mockReset();
  mergeTabToPaneSpy.mockReset();
  createWorkspaceFromSurfaceSpy.mockReset();
  cancelTabDrag();
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
  // jsdom doesn't implement elementFromPoint — return null so
  // detectDropTarget short-circuits to no drop target.
  document.elementFromPoint = vi.fn().mockReturnValue(null);
});

afterEach(() => {
  cancelTabDrag();
});

describe("tab-drag — threshold", () => {
  it("does not activate before 5px movement", () => {
    const pane = makePane([mockTerminalSurface()]);
    const ws = makeWorkspace(pane);
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    const sourceEl = document.createElement("div");
    document.body.appendChild(sourceEl);
    const down = mouseEvent("mousedown", { clientX: 100, clientY: 100 });
    Object.defineProperty(down, "currentTarget", { value: sourceEl });

    startTabDrag(down, pane.surfaces[0]!.id, pane.id, ws.id);

    // Move only 3px — below threshold
    window.dispatchEvent(
      mouseEvent("mousemove", { clientX: 102, clientY: 102 }),
    );
    expect(get(tabDragState)).toBeNull();
  });

  it("activates after >5px movement", () => {
    const pane = makePane([mockTerminalSurface()]);
    const ws = makeWorkspace(pane);
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    const sourceEl = document.createElement("div");
    document.body.appendChild(sourceEl);
    const down = mouseEvent("mousedown", { clientX: 100, clientY: 100 });
    Object.defineProperty(down, "currentTarget", { value: sourceEl });

    startTabDrag(down, pane.surfaces[0]!.id, pane.id, ws.id);

    window.dispatchEvent(
      mouseEvent("mousemove", { clientX: 110, clientY: 110 }),
    );
    expect(get(tabDragState)).not.toBeNull();
  });
});

describe("tab-drag — cancel", () => {
  it("cancelTabDrag clears state to null", () => {
    const pane = makePane([mockTerminalSurface()]);
    const ws = makeWorkspace(pane);
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    const sourceEl = document.createElement("div");
    document.body.appendChild(sourceEl);
    const down = mouseEvent("mousedown", { clientX: 100, clientY: 100 });
    Object.defineProperty(down, "currentTarget", { value: sourceEl });
    startTabDrag(down, pane.surfaces[0]!.id, pane.id, ws.id);
    window.dispatchEvent(
      mouseEvent("mousemove", { clientX: 110, clientY: 110 }),
    );
    expect(get(tabDragState)).not.toBeNull();

    cancelTabDrag();
    expect(get(tabDragState)).toBeNull();
  });
});

describe("tab-drag — commitTabDrop", () => {
  it("is a no-op when dropTarget is null", () => {
    const pane = makePane([mockTerminalSurface()]);
    const ws = makeWorkspace(pane);
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    // No active drag state — commit should not call any service.
    commitTabDrop();
    expect(reorderTabSpy).not.toHaveBeenCalled();
  });

  it("calls reorderTab with insertIdx (no pre-adjustment)", () => {
    // [A, B, C] — drag A (idx 0) to insertIdx=2 (drop between B and C).
    // Existing reorderTab semantics: toIdx is the "insert-before-original-idx"
    // value. reorderTab(0, 2) on [A,B,C] yields [B,A,C], which is the
    // expected result — so commitTabDrop must pass insertIdx directly.
    const sA = mockTerminalSurface({ title: "A" });
    const sB = mockTerminalSurface({ title: "B" });
    const sC = mockTerminalSurface({ title: "C" });
    const pane = makePane([sA, sB, sC]);
    const ws = makeWorkspace(pane);
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    __setTabDropTargetForTest({
      surfaceId: sA.id,
      sourcePaneId: pane.id,
      sourceWorkspaceId: ws.id,
      position: { x: 0, y: 0 },
      dropTarget: { kind: "reorder", paneId: pane.id, insertIdx: 2 },
    });

    commitTabDrop();
    expect(reorderTabSpy).toHaveBeenCalledTimes(1);
    expect(reorderTabSpy).toHaveBeenCalledWith(pane.id, 0, 2);
  });

  it("calls mergeTabToPane when dropping on another pane's tab bar", () => {
    const sA = mockTerminalSurface({ title: "A" });
    const paneA = makePane([sA]);
    const paneB = makePane([mockTerminalSurface({ title: "B" })]);
    const ws: import("../lib/types").NestedWorkspace = {
      id: uid(),
      name: "WS",
      splitRoot: {
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        children: [
          { type: "pane", pane: paneA },
          { type: "pane", pane: paneB },
        ],
      },
      activePaneId: paneA.id,
    };
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    __setTabDropTargetForTest({
      surfaceId: sA.id,
      sourcePaneId: paneA.id,
      sourceWorkspaceId: ws.id,
      position: { x: 0, y: 0 },
      dropTarget: { kind: "merge", paneId: paneB.id },
    });

    commitTabDrop();
    expect(mergeTabToPaneSpy).toHaveBeenCalledTimes(1);
    expect(mergeTabToPaneSpy).toHaveBeenCalledWith(sA.id, paneA.id, paneB.id);
  });

  it("clears tabDragState after commit", () => {
    const sA = mockTerminalSurface({ title: "A" });
    const pane = makePane([sA]);
    const ws = makeWorkspace(pane);
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    __setTabDropTargetForTest({
      surfaceId: sA.id,
      sourcePaneId: pane.id,
      sourceWorkspaceId: ws.id,
      position: { x: 0, y: 0 },
      dropTarget: null,
    });

    commitTabDrop();
    expect(get(tabDragState)).toBeNull();
  });

  it("calls splitPaneWithSurface with horizontal/before=false for zone=right", () => {
    const sA = mockTerminalSurface({ title: "A" });
    const paneA = makePane([sA]);
    const paneB = makePane([mockTerminalSurface({ title: "B" })]);
    const ws: import("../lib/types").NestedWorkspace = {
      id: uid(),
      name: "WS",
      splitRoot: {
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        children: [
          { type: "pane", pane: paneA },
          { type: "pane", pane: paneB },
        ],
      },
      activePaneId: paneA.id,
    };
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    __setTabDropTargetForTest({
      surfaceId: sA.id,
      sourcePaneId: paneA.id,
      sourceWorkspaceId: ws.id,
      position: { x: 0, y: 0 },
      dropTarget: { kind: "surface-split", paneId: paneB.id, zone: "right" },
    });

    commitTabDrop();
    expect(splitPaneWithSurfaceSpy).toHaveBeenCalledWith(
      sA.id,
      paneA.id,
      paneB.id,
      "horizontal",
      false,
    );
  });

  it("calls splitPaneWithSurface with horizontal/before=true for zone=left", () => {
    const sA = mockTerminalSurface({ title: "A" });
    const paneA = makePane([sA]);
    const paneB = makePane([mockTerminalSurface({ title: "B" })]);
    const ws: import("../lib/types").NestedWorkspace = {
      id: uid(),
      name: "WS",
      splitRoot: {
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        children: [
          { type: "pane", pane: paneA },
          { type: "pane", pane: paneB },
        ],
      },
      activePaneId: paneA.id,
    };
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    __setTabDropTargetForTest({
      surfaceId: sA.id,
      sourcePaneId: paneA.id,
      sourceWorkspaceId: ws.id,
      position: { x: 0, y: 0 },
      dropTarget: { kind: "surface-split", paneId: paneB.id, zone: "left" },
    });

    commitTabDrop();
    expect(splitPaneWithSurfaceSpy).toHaveBeenCalledWith(
      sA.id,
      paneA.id,
      paneB.id,
      "horizontal",
      true,
    );
  });

  it("calls splitPaneWithSurface with vertical/before=false for zone=bottom", () => {
    const sA = mockTerminalSurface({ title: "A" });
    const paneA = makePane([sA]);
    const paneB = makePane([mockTerminalSurface({ title: "B" })]);
    const ws: import("../lib/types").NestedWorkspace = {
      id: uid(),
      name: "WS",
      splitRoot: {
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        children: [
          { type: "pane", pane: paneA },
          { type: "pane", pane: paneB },
        ],
      },
      activePaneId: paneA.id,
    };
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    __setTabDropTargetForTest({
      surfaceId: sA.id,
      sourcePaneId: paneA.id,
      sourceWorkspaceId: ws.id,
      position: { x: 0, y: 0 },
      dropTarget: { kind: "surface-split", paneId: paneB.id, zone: "bottom" },
    });

    commitTabDrop();
    expect(splitPaneWithSurfaceSpy).toHaveBeenCalledWith(
      sA.id,
      paneA.id,
      paneB.id,
      "vertical",
      false,
    );
  });

  it("calls createNestedWorkspaceFromSurface with root insertIdx for new-workspace/before", () => {
    const sA = mockTerminalSurface({ title: "A" });
    const sB = mockTerminalSurface({ title: "B" });
    const pane = makePane([sA, sB]);
    const ws = makeWorkspace(pane);
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    __setTabDropTargetForTest({
      surfaceId: sA.id,
      sourcePaneId: pane.id,
      sourceWorkspaceId: ws.id,
      position: { x: 0, y: 0 },
      dropTarget: { kind: "new-workspace", insertIdx: 2, insertEdge: "before" },
    });

    commitTabDrop();
    expect(createWorkspaceFromSurfaceSpy).toHaveBeenCalledTimes(1);
    expect(createWorkspaceFromSurfaceSpy).toHaveBeenCalledWith(
      sA.id,
      pane.id,
      ws.id,
      { kind: "root", insertIdx: 2 },
    );
  });

  it("adds 1 to insertIdx for new-workspace/after", () => {
    const sA = mockTerminalSurface({ title: "A" });
    const sB = mockTerminalSurface({ title: "B" });
    const pane = makePane([sA, sB]);
    const ws = makeWorkspace(pane);
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    __setTabDropTargetForTest({
      surfaceId: sA.id,
      sourcePaneId: pane.id,
      sourceWorkspaceId: ws.id,
      position: { x: 0, y: 0 },
      dropTarget: { kind: "new-workspace", insertIdx: 1, insertEdge: "after" },
    });

    commitTabDrop();
    expect(createWorkspaceFromSurfaceSpy).toHaveBeenCalledWith(
      sA.id,
      pane.id,
      ws.id,
      { kind: "root", insertIdx: 2 },
    );
  });

  it("calls createNestedWorkspaceFromSurface with group positionInGroup for new-workspace-in-group/before", () => {
    const sA = mockTerminalSurface({ title: "A" });
    const sB = mockTerminalSurface({ title: "B" });
    const pane = makePane([sA, sB]);
    const ws = makeWorkspace(pane);
    const wsTarget = makeWorkspace(makePane([mockTerminalSurface()]));
    const wsTarget2 = makeWorkspace(makePane([mockTerminalSurface()]));
    nestedWorkspaces.set([ws, wsTarget, wsTarget2]);
    activeNestedWorkspaceIdx.set(0);

    vi.mocked(getWorkspaces).mockReturnValue([
      {
        id: "grp1",
        workspaceIds: [wsTarget.id, wsTarget2.id],
        name: "G",
        path: "/",
      } as never,
    ]);

    // Drop above wsTarget (global idx 1) → posInGroup 0, edge before → insertPos 0
    __setTabDropTargetForTest({
      surfaceId: sA.id,
      sourcePaneId: pane.id,
      sourceWorkspaceId: ws.id,
      position: { x: 0, y: 0 },
      dropTarget: {
        kind: "new-workspace-in-group",
        groupId: "grp1",
        insertGlobalIdx: 1,
        insertEdge: "before",
      },
    });

    commitTabDrop();
    expect(createWorkspaceFromSurfaceSpy).toHaveBeenCalledWith(
      sA.id,
      pane.id,
      ws.id,
      expect.objectContaining({
        kind: "group",
        positionInGroup: 0,
        targetGroupId: "grp1",
      }),
    );
  });

  it("calls createNestedWorkspaceFromSurface with group positionInGroup for new-workspace-in-group/after", () => {
    const sA = mockTerminalSurface({ title: "A" });
    const sB = mockTerminalSurface({ title: "B" });
    const pane = makePane([sA, sB]);
    const ws = makeWorkspace(pane);
    const wsTarget = makeWorkspace(makePane([mockTerminalSurface()]));
    const wsTarget2 = makeWorkspace(makePane([mockTerminalSurface()]));
    nestedWorkspaces.set([ws, wsTarget, wsTarget2]);
    activeNestedWorkspaceIdx.set(0);

    vi.mocked(getWorkspaces).mockReturnValue([
      {
        id: "grp1",
        workspaceIds: [wsTarget.id, wsTarget2.id],
        name: "G",
        path: "/",
      } as never,
    ]);

    // Drop below wsTarget (global idx 1) → posInGroup 0, edge after → insertPos 1
    __setTabDropTargetForTest({
      surfaceId: sA.id,
      sourcePaneId: pane.id,
      sourceWorkspaceId: ws.id,
      position: { x: 0, y: 0 },
      dropTarget: {
        kind: "new-workspace-in-group",
        groupId: "grp1",
        insertGlobalIdx: 1,
        insertEdge: "after",
      },
    });

    commitTabDrop();
    expect(createWorkspaceFromSurfaceSpy).toHaveBeenCalledWith(
      sA.id,
      pane.id,
      ws.id,
      expect.objectContaining({
        kind: "group",
        positionInGroup: 1,
        targetGroupId: "grp1",
      }),
    );
  });

  it("calls splitPaneWithSurface with vertical/before=true for zone=top", () => {
    const sA = mockTerminalSurface({ title: "A" });
    const paneA = makePane([sA]);
    const paneB = makePane([mockTerminalSurface({ title: "B" })]);
    const ws: import("../lib/types").NestedWorkspace = {
      id: uid(),
      name: "WS",
      splitRoot: {
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        children: [
          { type: "pane", pane: paneA },
          { type: "pane", pane: paneB },
        ],
      },
      activePaneId: paneA.id,
    };
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    __setTabDropTargetForTest({
      surfaceId: sA.id,
      sourcePaneId: paneA.id,
      sourceWorkspaceId: ws.id,
      position: { x: 0, y: 0 },
      dropTarget: { kind: "surface-split", paneId: paneB.id, zone: "top" },
    });

    commitTabDrop();
    expect(splitPaneWithSurfaceSpy).toHaveBeenCalledWith(
      sA.id,
      paneA.id,
      paneB.id,
      "vertical",
      true,
    );
  });
});

describe("tab-drag — tab hover activation", () => {
  function buildTabElement(surfaceId: string, paneId: string): HTMLElement {
    const tabBar = document.createElement("div");
    tabBar.setAttribute("data-pane-id", paneId);

    const tab = document.createElement("div");
    tab.setAttribute("data-tab-surface-id", surfaceId);
    tabBar.appendChild(tab);
    document.body.appendChild(tabBar);
    return tab;
  }

  it("activates a tab in another pane when dragging over it", () => {
    const sA = mockTerminalSurface({ title: "A" });
    const sB = mockTerminalSurface({ title: "B" });
    const sC = mockTerminalSurface({ title: "C" });
    const paneA = makePane([sA]);
    const paneB = makePane([sB, sC]);
    paneB.activeSurfaceId = sB.id;

    const ws = {
      id: uid(),
      name: "WS",
      splitRoot: {
        type: "split" as const,
        direction: "horizontal" as const,
        ratio: 0.5,
        children: [
          { type: "pane" as const, pane: paneA },
          { type: "pane" as const, pane: paneB },
        ],
      },
      activePaneId: paneA.id,
    };
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    const tabEl = buildTabElement(sC.id, paneB.id);
    document.elementFromPoint = vi.fn().mockReturnValue(tabEl);

    const sourceEl = document.createElement("div");
    document.body.appendChild(sourceEl);
    const down = mouseEvent("mousedown", { clientX: 100, clientY: 100 });
    Object.defineProperty(down, "currentTarget", { value: sourceEl });

    startTabDrag(down, sA.id, paneA.id, ws.id);
    window.dispatchEvent(
      mouseEvent("mousemove", { clientX: 110, clientY: 110 }),
    );

    const updated = get(nestedWorkspaces);
    const updatedPaneB =
      updated[0]!.splitRoot.type === "split"
        ? updated[0]!.splitRoot.children[1]
        : null;
    const pane = updatedPaneB?.type === "pane" ? updatedPaneB.pane : null;
    expect(pane?.activeSurfaceId).toBe(sC.id);
  });

  it("does not activate a tab in the same pane", () => {
    const sA = mockTerminalSurface({ title: "A" });
    const sB = mockTerminalSurface({ title: "B" });
    const pane = makePane([sA, sB]);
    pane.activeSurfaceId = sA.id;
    const ws = makeWorkspace(pane);
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    const tabEl = buildTabElement(sB.id, pane.id);
    document.elementFromPoint = vi.fn().mockReturnValue(tabEl);

    const sourceEl = document.createElement("div");
    document.body.appendChild(sourceEl);
    const down = mouseEvent("mousedown", { clientX: 100, clientY: 100 });
    Object.defineProperty(down, "currentTarget", { value: sourceEl });

    startTabDrag(down, sA.id, pane.id, ws.id);
    window.dispatchEvent(
      mouseEvent("mousemove", { clientX: 110, clientY: 110 }),
    );

    expect(
      get(nestedWorkspaces)[0]!.splitRoot.type === "pane"
        ? (get(nestedWorkspaces)[0]!.splitRoot as { pane: typeof pane }).pane
            .activeSurfaceId
        : null,
    ).toBe(sA.id);
  });
});

describe("tab-drag — surface body detection", () => {
  it("detects surface-split on source pane when it has ≥2 surfaces", () => {
    const sA = mockTerminalSurface({ title: "A" });
    const sB = mockTerminalSurface({ title: "B" });
    const pane = makePane([sA, sB]);
    const ws = makeWorkspace(pane);
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    const bodyEl = document.createElement("div");
    bodyEl.setAttribute("data-pane-body", pane.id);
    bodyEl.getBoundingClientRect = vi.fn().mockReturnValue({
      left: 0,
      right: 400,
      top: 28,
      bottom: 300,
      width: 400,
      height: 272,
      x: 0,
      y: 28,
      toJSON: () => {},
    });
    document.body.appendChild(bodyEl);
    document.elementFromPoint = vi.fn().mockReturnValue(null);

    const sourceEl = document.createElement("div");
    document.body.appendChild(sourceEl);
    const down = mouseEvent("mousedown", { clientX: 0, clientY: 0 });
    Object.defineProperty(down, "currentTarget", { value: sourceEl });

    startTabDrag(down, sA.id, pane.id, ws.id);
    // Drop into bottom half of the same pane's surface
    window.dispatchEvent(
      mouseEvent("mousemove", { clientX: 200, clientY: 250 }),
    );

    const state = get(tabDragState);
    expect(state?.dropTarget?.kind).toBe("surface-split");
    if (state?.dropTarget?.kind === "surface-split") {
      expect(state.dropTarget.paneId).toBe(pane.id);
    }
  });

  it("does not detect surface-split on source pane when it has only 1 surface", () => {
    const sA = mockTerminalSurface({ title: "A" });
    const pane = makePane([sA]);
    const ws = makeWorkspace(pane);
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    const bodyEl = document.createElement("div");
    bodyEl.setAttribute("data-pane-body", pane.id);
    bodyEl.getBoundingClientRect = vi.fn().mockReturnValue({
      left: 0,
      right: 400,
      top: 28,
      bottom: 300,
      width: 400,
      height: 272,
      x: 0,
      y: 28,
      toJSON: () => {},
    });
    document.body.appendChild(bodyEl);
    document.elementFromPoint = vi.fn().mockReturnValue(null);

    const sourceEl = document.createElement("div");
    document.body.appendChild(sourceEl);
    const down = mouseEvent("mousedown", { clientX: 0, clientY: 0 });
    Object.defineProperty(down, "currentTarget", { value: sourceEl });

    startTabDrag(down, sA.id, pane.id, ws.id);
    window.dispatchEvent(
      mouseEvent("mousemove", { clientX: 200, clientY: 250 }),
    );

    const state = get(tabDragState);
    expect(state?.dropTarget).toBeNull();
  });

  it("detects surface-split zone via bounding rect scan", () => {
    const sA = mockTerminalSurface({ title: "A" });
    const sB = mockTerminalSurface({ title: "B" });
    const paneA = makePane([sA]);
    const paneB = makePane([sB]);
    const ws: import("../lib/types").NestedWorkspace = {
      id: uid(),
      name: "WS",
      splitRoot: {
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        children: [
          { type: "pane", pane: paneA },
          { type: "pane", pane: paneB },
        ],
      },
      activePaneId: paneA.id,
    };
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    // Set up a pane body element for paneB with known bounds.
    const bodyEl = document.createElement("div");
    bodyEl.setAttribute("data-pane-body", paneB.id);
    bodyEl.getBoundingClientRect = vi.fn().mockReturnValue({
      left: 200,
      right: 400,
      top: 100,
      bottom: 300,
      width: 200,
      height: 200,
      x: 200,
      y: 100,
      toJSON: () => {},
    });
    document.body.appendChild(bodyEl);

    // elementFromPoint returns null so the tab-bar / sidebar checks all skip.
    document.elementFromPoint = vi.fn().mockReturnValue(null);

    const sourceEl = document.createElement("div");
    document.body.appendChild(sourceEl);
    const down = mouseEvent("mousedown", { clientX: 0, clientY: 0 });
    Object.defineProperty(down, "currentTarget", { value: sourceEl });

    startTabDrag(down, sA.id, paneA.id, ws.id);
    // Move into paneB's right-zone: x=350 is 75% of width → "right"
    window.dispatchEvent(
      mouseEvent("mousemove", { clientX: 350, clientY: 200 }),
    );

    const state = get(tabDragState);
    expect(state?.dropTarget?.kind).toBe("surface-split");
    if (state?.dropTarget?.kind === "surface-split") {
      expect(state.dropTarget.zone).toBe("right");
      expect(state.dropTarget.paneId).toBe(paneB.id);
    }
  });
});

describe("tab-drag — detectDropTarget: root tab over nested workspace row", () => {
  it("returns new-workspace-in-group when cursor is over a row inside a group container", () => {
    const sA = mockTerminalSurface({ title: "A" });
    const sB = mockTerminalSurface({ title: "B" });
    const srcPane = makePane([sA, sB]);
    const srcWs = makeWorkspace(srcPane); // no groupId — root workspace

    const nestedPane = makePane([mockTerminalSurface({ title: "C" })]);
    const nestedWs: NestedWorkspace = {
      id: uid(),
      name: "nested",
      splitRoot: { type: "pane", pane: nestedPane },
      activePaneId: nestedPane.id,
      metadata: { groupId: "grp-1" },
    };
    nestedWorkspaces.set([srcWs, nestedWs]);
    activeNestedWorkspaceIdx.set(0);

    // Build DOM: container with data-container-nested, containing a workspace row
    const container = document.createElement("div");
    container.setAttribute("data-container-nested", "grp-1");
    const row = document.createElement("div");
    row.setAttribute("data-ws-view-drag-idx", "1");
    row.getBoundingClientRect = () =>
      ({
        top: 100,
        bottom: 140,
        height: 40,
        left: 0,
        right: 200,
        width: 200,
      }) as DOMRect;
    container.appendChild(row);
    document.body.appendChild(container);

    document.elementFromPoint = vi.fn().mockReturnValue(row);

    const sourceEl = document.createElement("div");
    document.body.appendChild(sourceEl);
    const down = mouseEvent("mousedown", { clientX: 50, clientY: 120 });
    Object.defineProperty(down, "currentTarget", { value: sourceEl });
    startTabDrag(down, sA.id, srcPane.id, srcWs.id);
    // Move >5px to activate the drag state machine
    window.dispatchEvent(
      mouseEvent("mousemove", { clientX: 60, clientY: 120 }),
    );

    const state = get(tabDragState);
    expect(state?.dropTarget?.kind).toBe("new-workspace-in-group");
    if (state?.dropTarget?.kind === "new-workspace-in-group") {
      expect(state.dropTarget.groupId).toBe("grp-1");
    }
  });
});

describe("tab-drag — commitTabDrop: new-workspace-in-group passes targetGroupId", () => {
  it("calls createNestedWorkspaceFromSurface with targetGroupId matching the drop group", () => {
    const sA = mockTerminalSurface({ title: "A" });
    const sB = mockTerminalSurface({ title: "B" });
    const pane = makePane([sA, sB]);
    const ws = makeWorkspace(pane); // root workspace — no groupId
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    // Mock getWorkspaces to return a group with the workspace
    vi.mocked(getWorkspaces).mockReturnValue([
      { id: "grp-1", workspaceIds: [ws.id], name: "Group 1" },
    ]);

    __setTabDropTargetForTest({
      surfaceId: sA.id,
      sourcePaneId: pane.id,
      sourceWorkspaceId: ws.id,
      position: { x: 0, y: 0 },
      dropTarget: {
        kind: "new-workspace-in-group",
        groupId: "grp-1",
        insertGlobalIdx: 0,
        insertEdge: "after",
      },
    });

    commitTabDrop();

    expect(createWorkspaceFromSurfaceSpy).toHaveBeenCalledWith(
      sA.id,
      pane.id,
      ws.id,
      expect.objectContaining({ targetGroupId: "grp-1" }),
    );
  });
});
