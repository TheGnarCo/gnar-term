/**
 * Tests for workspaceHistory store and switchToLastWorkspace.
 *
 * Verifies that:
 * - workspaceHistory updates on each switchWorkspace call
 * - switchToLastWorkspace bounces to the previous workspace
 * - switching with only one workspace does nothing on toggle
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

// --- Mocks (must precede imports that pull in Tauri/xterm) ---

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

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    open = vi.fn();
    write = vi.fn();
    focus = vi.fn();
    dispose = vi.fn();
    cols = 80;
    rows = 24;
    onData = vi.fn();
    onResize = vi.fn();
    onTitleChange = vi.fn();
    loadAddon = vi.fn();
    options: Record<string, unknown> = {};
    buffer = { active: { getLine: vi.fn() } };
    parser = { registerOscHandler: vi.fn() };
    attachCustomKeyEventHandler = vi.fn();
    registerLinkProvider = vi.fn();
    getSelection = vi.fn().mockReturnValue("");
    hasSelection = vi.fn().mockReturnValue(false);
    onSelectionChange = vi.fn();
    scrollToBottom = vi.fn();
    onScroll = vi.fn().mockReturnValue({ dispose: vi.fn() });
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
    activate = vi.fn();
    dispose = vi.fn();
  },
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    activate = vi.fn();
    dispose = vi.fn();
    onContextLoss = vi.fn();
  },
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {
    activate = vi.fn();
    dispose = vi.fn();
  },
}));
vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {
    activate = vi.fn();
    dispose = vi.fn();
    findNext = vi.fn();
    findPrevious = vi.fn();
    clearDecorations = vi.fn();
  },
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

vi.mock("../lib/config", () => ({
  getConfig: vi.fn(() => ({})),
  saveConfig: vi.fn().mockResolvedValue(undefined),
  saveState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/services/service-helpers", () => ({
  safeFocus: vi.fn(),
  getActiveCwd: vi.fn().mockResolvedValue(undefined),
  getCwdForSurface: vi.fn().mockResolvedValue(undefined),
  getHome: vi.fn().mockResolvedValue("/home/test"),
}));

vi.mock("../lib/services/event-bus", () => ({
  eventBus: { emit: vi.fn(), on: vi.fn(() => vi.fn()) },
}));

vi.mock("../lib/services/workspace-service", () => ({
  addChildToWorkspace: vi.fn(),
  insertChildIntoWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
}));

vi.mock("../lib/stores/root-row-order", () => ({
  appendRootRow: vi.fn(),
  removeRootRow: vi.fn(),
  insertRootRow: vi.fn(),
}));

vi.mock("../lib/services/session-log-service", () => ({
  readTerminalBuffer: vi.fn().mockResolvedValue(""),
  writeSessionLog: vi.fn().mockResolvedValue(undefined),
}));

vi.stubGlobal("localStorage", {
  getItem: vi.fn().mockReturnValue(null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
});

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal("ResizeObserver", MockResizeObserver);

// --- Imports (after mocks) ---

import {
  workspaces,
  activeWorkspaceIdx,
  workspaceHistory,
} from "../lib/stores/workspace";
import { uid } from "../lib/types";
import type { Workspace, Pane } from "../lib/types";
import {
  switchWorkspace,
  switchToLastWorkspace,
} from "../lib/services/workspace-runtime-service";

// --- Helpers ---

function makeWorkspace(name: string): Workspace {
  const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
  return {
    id: uid(),
    name,
    paneLayout: { type: "pane", pane },
    activePaneId: pane.id,
  };
}

function setup(initialWorkspaces: Workspace[], activeIdx = 0) {
  workspaces.set(initialWorkspaces);
  activeWorkspaceIdx.set(activeIdx);
  workspaceHistory.set([null, null]);
}

beforeEach(() => {
  workspaces.set([]);
  activeWorkspaceIdx.set(-1);
  workspaceHistory.set([null, null]);
  vi.clearAllMocks();
});

describe("workspaceHistory", () => {
  it("starts as [null, null]", () => {
    expect(get(workspaceHistory)).toEqual([null, null]);
  });

  it("records [null, newId] on first switch", () => {
    const ws = makeWorkspace("alpha");
    setup([ws]);
    activeWorkspaceIdx.set(-1);
    workspaceHistory.set([null, null]);

    switchWorkspace(0);

    const [prev, cur] = get(workspaceHistory);
    expect(cur).toBe(ws.id);
    expect(prev).toBeNull();
  });

  it("records [previousId, newId] on second switch", () => {
    const a = makeWorkspace("alpha");
    const b = makeWorkspace("beta");
    setup([a, b], 0);
    workspaceHistory.set([null, a.id]);

    switchWorkspace(1);

    const [prev, cur] = get(workspaceHistory);
    expect(prev).toBe(a.id);
    expect(cur).toBe(b.id);
  });

  it("slides history window on repeated switches", () => {
    const a = makeWorkspace("alpha");
    const b = makeWorkspace("beta");
    const c = makeWorkspace("gamma");
    setup([a, b, c], 0);
    workspaceHistory.set([null, a.id]);

    switchWorkspace(1);
    expect(get(workspaceHistory)).toEqual([a.id, b.id]);

    switchWorkspace(2);
    expect(get(workspaceHistory)).toEqual([b.id, c.id]);
  });
});

describe("switchToLastWorkspace", () => {
  it("switches to previous workspace", () => {
    const a = makeWorkspace("alpha");
    const b = makeWorkspace("beta");
    setup([a, b], 1);
    workspaceHistory.set([a.id, b.id]);

    switchToLastWorkspace();

    expect(get(activeWorkspaceIdx)).toBe(0);
  });

  it("does nothing when prevId is null", () => {
    const a = makeWorkspace("alpha");
    setup([a], 0);
    workspaceHistory.set([null, a.id]);

    switchToLastWorkspace();

    expect(get(activeWorkspaceIdx)).toBe(0);
  });

  it("does nothing when previous workspace no longer exists", () => {
    const a = makeWorkspace("alpha");
    setup([a], 0);
    workspaceHistory.set(["deleted-id", a.id]);

    switchToLastWorkspace();

    expect(get(activeWorkspaceIdx)).toBe(0);
  });

  it("toggles between two workspaces with repeated calls", () => {
    const a = makeWorkspace("alpha");
    const b = makeWorkspace("beta");
    setup([a, b], 1);
    workspaceHistory.set([a.id, b.id]);

    switchToLastWorkspace();
    expect(get(activeWorkspaceIdx)).toBe(0);

    switchToLastWorkspace();
    expect(get(activeWorkspaceIdx)).toBe(1);
  });
});
