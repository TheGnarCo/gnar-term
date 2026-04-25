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

// Spy on pane-service.reorderTab so we can verify args without
// running a real reorder.
const reorderTabSpy = vi.fn();
vi.mock("../lib/services/pane-service", async () => {
  const actual = await vi.importActual<
    typeof import("../lib/services/pane-service")
  >("../lib/services/pane-service");
  return {
    ...actual,
    reorderTab: (...args: Parameters<typeof actual.reorderTab>) =>
      reorderTabSpy(...args),
  };
});

import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import {
  uid,
  type Workspace,
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

function makeWorkspace(pane: Pane): Workspace {
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
  workspaces.set([]);
  activeWorkspaceIdx.set(-1);
  reorderTabSpy.mockReset();
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
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

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
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

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
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

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
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

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
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

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

  it("clears tabDragState after commit", () => {
    const sA = mockTerminalSurface({ title: "A" });
    const pane = makePane([sA]);
    const ws = makeWorkspace(pane);
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

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
});
