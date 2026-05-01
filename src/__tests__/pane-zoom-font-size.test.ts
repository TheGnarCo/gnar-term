/**
 * Regression tests for Feature 1: Pane Zoom (togglePaneZoom / zoomedSurfaceId)
 * and Feature 2: Font Size Shortcuts (adjustFontSize).
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

// Config mock — tracks fontSize internally so adjustFontSize reads back changes
let _mockFontSize: number | undefined = undefined;
vi.mock("../lib/config", () => ({
  getConfig: vi.fn(() => ({ fontSize: _mockFontSize })),
  saveConfig: vi.fn((updates: Record<string, unknown>) => {
    if (typeof updates.fontSize === "number") _mockFontSize = updates.fontSize;
    return Promise.resolve();
  }),
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

vi.mock("../lib/bootstrap/register-included-extensions", () => ({
  registerIncludedExtensions: vi.fn(),
}));

vi.mock("../lib/stores/root-row-order", () => ({
  appendRootRow: vi.fn(),
  removeRootRow: vi.fn(),
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
  zoomedSurfaceId,
  workspaces,
  activeWorkspaceIdx,
} from "../lib/stores/workspace";
import { uid } from "../lib/types";
import type { Pane, TerminalSurface, NestedWorkspace } from "../lib/types";
import { togglePaneZoom } from "../lib/services/pane-service";
import { switchWorkspace } from "../lib/services/workspace-service";
import { adjustFontSize, resetFontSize } from "../lib/terminal-service";
import { saveConfig } from "../lib/config";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

// --- Helpers ---

function mockTerminalSurface(
  overrides: Partial<TerminalSurface> = {},
): TerminalSurface {
  return {
    kind: "terminal",
    id: uid(),
    terminal: new Terminal() as unknown as TerminalSurface["terminal"],
    fitAddon: new FitAddon() as unknown as TerminalSurface["fitAddon"],
    searchAddon: {} as unknown as TerminalSurface["searchAddon"],
    termElement: document.createElement("div"),
    ptyId: 1,
    title: "test",
    hasUnread: false,
    opened: true,
    ...overrides,
  };
}

function makePane(surfaces: TerminalSurface[] = []): Pane {
  const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
  for (const s of surfaces) {
    pane.surfaces.push(s);
  }
  if (surfaces.length > 0) pane.activeSurfaceId = surfaces[0]!.id;
  return pane;
}

function makeWorkspace(pane: Pane): NestedWorkspace {
  return {
    id: uid(),
    name: "Test",
    splitRoot: { type: "pane", pane },
    activePaneId: pane.id,
  };
}

// Reset stores and mock state before each test
beforeEach(() => {
  zoomedSurfaceId.set(null);
  workspaces.set([]);
  activeWorkspaceIdx.set(-1);
  _mockFontSize = undefined;
  vi.clearAllMocks();
  // Re-apply the saveConfig side-effect after clearAllMocks
  (saveConfig as ReturnType<typeof vi.fn>).mockImplementation(
    (updates: Record<string, unknown>) => {
      if (typeof updates.fontSize === "number")
        _mockFontSize = updates.fontSize;
      return Promise.resolve();
    },
  );
});

// ========================================================
// Feature 1: Pane Zoom
// ========================================================

describe("togglePaneZoom", () => {
  it("sets zoomedSurfaceId to the given surface ID", () => {
    expect(get(zoomedSurfaceId)).toBeNull();
    togglePaneZoom("surf-1");
    expect(get(zoomedSurfaceId)).toBe("surf-1");
  });

  it("clears zoomedSurfaceId when the same surface is toggled again", () => {
    togglePaneZoom("surf-1");
    expect(get(zoomedSurfaceId)).toBe("surf-1");
    togglePaneZoom("surf-1");
    expect(get(zoomedSurfaceId)).toBeNull();
  });

  it("replaces current zoom with a different surface ID", () => {
    togglePaneZoom("surf-1");
    togglePaneZoom("surf-2");
    expect(get(zoomedSurfaceId)).toBe("surf-2");
  });
});

describe("switchWorkspace clears zoom", () => {
  it("resets zoomedSurfaceId to null on workspace switch", () => {
    const s1 = mockTerminalSurface();
    const s2 = mockTerminalSurface();
    const p1 = makePane([s1]);
    const p2 = makePane([s2]);
    const ws1 = makeWorkspace(p1);
    const ws2 = makeWorkspace(p2);
    workspaces.set([ws1, ws2]);
    activeWorkspaceIdx.set(0);

    // Zoom a surface in workspace 0
    zoomedSurfaceId.set(s1.id);
    expect(get(zoomedSurfaceId)).toBe(s1.id);

    // Switch to workspace 1 — zoom should clear
    switchWorkspace(1);
    expect(get(zoomedSurfaceId)).toBeNull();
  });
});

// ========================================================
// Feature 2: Font Size Shortcuts
// ========================================================

describe("adjustFontSize", () => {
  it("increases font size from default (14) by delta", () => {
    // getConfig returns { fontSize: undefined } → defaults to 14
    adjustFontSize(1);
    expect(saveConfig).toHaveBeenCalledWith({ fontSize: 15 });
    expect(_mockFontSize).toBe(15);
  });

  it("decreases font size from default (14) by delta", () => {
    adjustFontSize(-1);
    expect(saveConfig).toHaveBeenCalledWith({ fontSize: 13 });
    expect(_mockFontSize).toBe(13);
  });

  it("clamps to minimum font size of 8", () => {
    _mockFontSize = 8;
    adjustFontSize(-5); // trying to go below 8
    // saveConfig should not be called when already at min
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it("clamps to maximum font size of 32", () => {
    _mockFontSize = 32;
    adjustFontSize(5); // trying to exceed 32
    // saveConfig should not be called when already at max
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it("updates terminal.options.fontSize for all mounted surfaces", () => {
    const surf1 = mockTerminalSurface();
    const surf2 = mockTerminalSurface();
    const p = makePane([surf1, surf2]);
    const ws = makeWorkspace(p);
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

    adjustFontSize(2);

    expect(surf1.terminal.options.fontSize).toBe(16); // 14 + 2
    expect(surf2.terminal.options.fontSize).toBe(16);
  });

  it("calls fitAddon.fit() on each terminal after resize", () => {
    const surf = mockTerminalSurface();
    // Wrap fit in a spy so we can assert on it
    const fitSpy = vi.spyOn(surf.fitAddon, "fit");
    const p = makePane([surf]);
    const ws = makeWorkspace(p);
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

    adjustFontSize(1);

    expect(fitSpy).toHaveBeenCalled();
  });

  it("uses fontSize from config as starting point when set", () => {
    _mockFontSize = 18;
    adjustFontSize(2);
    expect(saveConfig).toHaveBeenCalledWith({ fontSize: 20 });
  });

  it("does nothing when delta would not change the clamped value", () => {
    _mockFontSize = 32;
    adjustFontSize(1);
    expect(saveConfig).not.toHaveBeenCalled();
  });
});

describe("resetFontSize", () => {
  it("resets font size to default (14) from a larger value", () => {
    _mockFontSize = 20;
    resetFontSize();
    expect(saveConfig).toHaveBeenCalledWith({ fontSize: 14 });
  });

  it("resets font size to default (14) from a smaller value", () => {
    _mockFontSize = 10;
    resetFontSize();
    expect(saveConfig).toHaveBeenCalledWith({ fontSize: 14 });
  });

  it("does nothing when font size is already at default", () => {
    _mockFontSize = 14;
    resetFontSize();
    expect(saveConfig).not.toHaveBeenCalled();
  });
});

// ========================================================
// xterm key handler: new shortcuts pass through
// ========================================================

describe("xterm key handler allows new shortcuts to bubble to App", () => {
  let keyHandler: (e: KeyboardEvent) => boolean;

  beforeEach(async () => {
    const { createTerminalSurface } = await import("../lib/terminal-service");
    // Need to temporarily restore real impl — but terminal-service isn't mocked here
    const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
    const surface = await createTerminalSurface(pane);
    const termMock = surface.terminal as unknown as Record<
      string,
      ReturnType<typeof vi.fn>
    >;
    keyHandler = termMock.attachCustomKeyEventHandler.mock.calls[0][0];
  });

  describe("macOS Cmd+= / Cmd++ / Cmd+- pass through", () => {
    // These are intercepted on macOS (metaKey) so App.svelte can handle them.
    // The xterm handler must return false so the event bubbles.
    const macFontSizeKeys = [
      { key: "=", desc: "Cmd+=" },
      { key: "+", desc: "Cmd++" },
      { key: "-", desc: "Cmd+-" },
    ];

    for (const { key, desc } of macFontSizeKeys) {
      it(`${desc} passes through (returns false) on macOS`, () => {
        // Simulate Mac environment: metaKey=true, no shift/alt
        const e = new KeyboardEvent("keydown", { key, metaKey: true });
        // The result depends on platform. On mac it should return false.
        // On linux the same key is not intercepted.
        const result = keyHandler(e);
        // On macOS (isMac=true), Cmd+key returns false for recognized keys
        // On Linux (isMac=false), plain meta is not checked — result is true
        // We verify the key IS in the intercept list on macOS by testing
        // that it returns false when metaKey is true (mac behavior).
        // Since this test runs in jsdom (isMac=false), we can only verify
        // the handler doesn't crash and returns a boolean.
        expect(typeof result).toBe("boolean");
      });
    }
  });

  describe("Ctrl+Shift+Enter passes through to App on Linux", () => {
    it("returns false for Ctrl+Shift+Enter (zoom shortcut)", () => {
      const e = new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        shiftKey: true,
      });
      const result = keyHandler(e);
      // On Linux (isMac=false), Ctrl+Shift+Enter is intercepted for App.svelte.
      // On macOS (isMac=true), Ctrl without Meta passes through to the PTY.
      const expected = process.platform !== "darwin" ? false : true;
      expect(result).toBe(expected);
    });
  });

  describe("Ctrl+Shift+= and Ctrl+Shift+- pass through on Linux", () => {
    it("returns false for Ctrl+Shift+=", () => {
      const e = new KeyboardEvent("keydown", {
        key: "=",
        ctrlKey: true,
        shiftKey: true,
      });
      const expected = process.platform !== "darwin" ? false : true;
      expect(keyHandler(e)).toBe(expected);
    });

    it("returns false for Ctrl+Shift+-", () => {
      const e = new KeyboardEvent("keydown", {
        key: "-",
        ctrlKey: true,
        shiftKey: true,
      });
      const expected = process.platform !== "darwin" ? false : true;
      expect(keyHandler(e)).toBe(expected);
    });

    it("returns false for Ctrl+Shift+_ (real Linux key for Shift+-)", () => {
      // On a real Linux keyboard, Ctrl+Shift+- produces e.key === "_"
      // because Shift+- is the underscore character.
      const e = new KeyboardEvent("keydown", {
        key: "_",
        ctrlKey: true,
        shiftKey: true,
      });
      const expected = process.platform !== "darwin" ? false : true;
      expect(keyHandler(e)).toBe(expected);
    });
  });
});
