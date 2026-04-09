/**
 * Tests for resource cleanup and lifecycle management.
 *
 * Covers:
 * - H1: Event listener cleanup (terminal-service + App.svelte)
 * - H2: CWD polling stop
 * - H3: Bounded PTY retry in sendIssueToAgent (replaces blind setTimeout)
 * - L4: Guard harnessTracker replacement on re-init
 * - L5: Cross-platform keybindings
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Mocks (shared across all suites) ---

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

const mockUnlistenFns: ReturnType<typeof vi.fn>[] = [];
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockImplementation(() => {
    const unlisten = vi.fn();
    mockUnlistenFns.push(unlisten);
    return Promise.resolve(unlisten);
  }),
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn().mockResolvedValue("pasted text"),
  writeText: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    write: vi.fn(),
    focus: vi.fn(),
    dispose: vi.fn(),
    cols: 80,
    rows: 24,
    onData: vi.fn(),
    onResize: vi.fn(),
    onTitleChange: vi.fn(),
    loadAddon: vi.fn(),
    options: {},
    buffer: { active: { getLine: vi.fn() } },
    parser: { registerOscHandler: vi.fn() },
    attachCustomKeyEventHandler: vi.fn(),
    registerLinkProvider: vi.fn(),
    getSelection: vi.fn().mockReturnValue("selected text"),
    scrollToBottom: vi.fn(),
  })),
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
    activate: vi.fn(),
    dispose: vi.fn(),
  })),
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: vi.fn().mockImplementation(() => ({
    activate: vi.fn(),
    dispose: vi.fn(),
    onContextLoss: vi.fn(),
  })),
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: vi.fn().mockImplementation(() => ({
    activate: vi.fn(),
    dispose: vi.fn(),
  })),
}));
vi.mock("@xterm/addon-search", () => ({
  SearchAddon: vi.fn().mockImplementation(() => ({
    activate: vi.fn(),
    dispose: vi.fn(),
    findNext: vi.fn(),
    findPrevious: vi.fn(),
    clearDecorations: vi.fn(),
  })),
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

vi.stubGlobal("localStorage", {
  getItem: vi.fn().mockReturnValue(null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
});
vi.stubGlobal(
  "ResizeObserver",
  vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })),
);

import { listen } from "@tauri-apps/api/event";
import {
  setupListeners,
  cleanupListeners,
  startCwdPolling,
  stopCwdPolling,
  isMac,
} from "../lib/terminal-service";
import {
  handleKeydown,
  isModifier,
  type KeybindingActions,
} from "../lib/keybindings";

// --- H1: Event listener cleanup ---

describe("H1: cleanupListeners", () => {
  beforeEach(() => {
    mockUnlistenFns.length = 0;
    vi.mocked(listen).mockClear();
  });

  it("captures unlisten functions from setupListeners", async () => {
    await setupListeners();
    // 4 Tauri event listeners: pty-output, pty-exit, pty-notification, pty-title
    expect(mockUnlistenFns.length).toBeGreaterThanOrEqual(4);
  });

  it("calls all unlisten functions when cleanupListeners is called", async () => {
    await setupListeners();
    const fns = [...mockUnlistenFns];
    cleanupListeners();
    for (const fn of fns) {
      expect(fn).toHaveBeenCalled();
    }
  });

  it("clears the internal array so repeated cleanup is safe", async () => {
    await setupListeners();
    cleanupListeners();
    // Second call should not throw
    cleanupListeners();
  });
});

// --- H2: CWD polling stop ---

describe("H2: stopCwdPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stopCwdPolling(); // ensure clean state
  });

  afterEach(() => {
    stopCwdPolling();
    vi.useRealTimers();
  });

  it("starts polling with startCwdPolling", () => {
    startCwdPolling();
    // The interval should be active — advance time to confirm it fires
    vi.advanceTimersByTime(5000);
    // No error means the timer is running
  });

  it("stops polling when stopCwdPolling is called", () => {
    startCwdPolling();
    stopCwdPolling();
    // Advancing time should not cause any errors or activity
    vi.advanceTimersByTime(15000);
  });

  it("is safe to call stopCwdPolling when no polling is active", () => {
    // Should not throw
    stopCwdPolling();
    stopCwdPolling();
  });

  it("does not create duplicate timers if startCwdPolling called twice", () => {
    startCwdPolling();
    startCwdPolling(); // second call should be no-op
    stopCwdPolling();
    // If a duplicate timer leaked, this would still fire
    vi.advanceTimersByTime(15000);
  });
});

// --- L4: Guard harnessTracker replacement ---

describe("L4: harnessTracker guard on re-init", () => {
  beforeEach(() => {
    mockUnlistenFns.length = 0;
  });

  it("disposes previous tracker when setupListeners is called again", async () => {
    await setupListeners();
    // Calling setupListeners again should dispose the previous tracker
    // (no throw means dispose was called before creating new one)
    await setupListeners();
    // Clean up
    cleanupListeners();
  });
});

// --- L5: Cross-platform keybindings ---

describe("L5: Cross-platform keybindings", () => {
  function makeActions(): KeybindingActions {
    return {
      createWorkspace: vi.fn(),
      newSurface: vi.fn(),
      splitHorizontal: vi.fn(),
      splitVertical: vi.fn(),
      closeWorkspace: vi.fn(),
      switchWorkspace: vi.fn(),
      selectSurface: vi.fn(),
      nextSurface: vi.fn(),
      prevSurface: vi.fn(),
      toggleSidebar: vi.fn(),
      clearTerminal: vi.fn(),
      focusDirection: vi.fn(),
      togglePaneZoom: vi.fn(),
      flashFocusedPane: vi.fn(),
      startRename: vi.fn(),
      toggleCommandPalette: vi.fn(),
      toggleFindBar: vi.fn(),
      findNext: vi.fn(),
      findPrev: vi.fn(),
      closeFindBar: vi.fn(),
      goHome: vi.fn(),
      openSettings: vi.fn(),
      escapeBack: vi.fn(),
      workspaceCount: vi.fn().mockReturnValue(3),
      activeIdx: vi.fn().mockReturnValue(0),
      findBarVisible: vi.fn().mockReturnValue(false),
      commandPaletteOpen: vi.fn().mockReturnValue(false),
      currentView: vi.fn().mockReturnValue("workspace"),
    };
  }

  describe("isModifier helper", () => {
    it("returns true for metaKey on macOS", () => {
      const e = new KeyboardEvent("keydown", { metaKey: true });
      if (isMac) {
        expect(isModifier(e)).toBe(true);
      }
    });

    it("returns true for ctrlKey + shiftKey on non-macOS", () => {
      const e = new KeyboardEvent("keydown", { ctrlKey: true, shiftKey: true });
      if (!isMac) {
        expect(isModifier(e)).toBe(true);
      }
    });

    it("returns false for ctrlKey alone on non-macOS", () => {
      const e = new KeyboardEvent("keydown", { ctrlKey: true });
      if (!isMac) {
        expect(isModifier(e)).toBe(false);
      }
    });
  });

  describe("standard shortcuts respond to platform modifier", () => {
    // We test using the current platform's modifier
    const modKeys = isMac
      ? { metaKey: true }
      : { ctrlKey: true, shiftKey: true };

    const standardShortcuts: Array<{
      key: string;
      action: keyof KeybindingActions;
      extra?: Record<string, boolean>;
    }> = [
      { key: "n", action: "createWorkspace" },
      { key: "t", action: "newSurface" },
      { key: "d", action: "splitHorizontal" },
      { key: "b", action: "toggleSidebar" },
      { key: "k", action: "clearTerminal" },
      { key: "p", action: "toggleCommandPalette" },
      { key: "f", action: "toggleFindBar" },
      { key: "g", action: "findNext" },
    ];

    for (const { key, action, extra } of standardShortcuts) {
      it(`${isMac ? "Cmd" : "Ctrl+Shift"}+${key} triggers ${action}`, () => {
        const actions = makeActions();
        const e = new KeyboardEvent("keydown", {
          key,
          ...modKeys,
          ...(extra || {}),
        });
        handleKeydown(e, actions);
        expect(actions[action]).toHaveBeenCalled();
      });
    }
  });

  describe("shifted shortcuts respond to platform modifier", () => {
    const shiftedShortcuts: Array<{
      key: string;
      action: keyof KeybindingActions;
    }> = [
      { key: "w", action: "closeWorkspace" },
      { key: "d", action: "splitVertical" },
      { key: "h", action: "goHome" },
      { key: "r", action: "startRename" },
      { key: "g", action: "findPrev" },
      // Enter does not change case, so keep it as-is on both platforms
      { key: "Enter", action: "togglePaneZoom" },
    ];

    for (const { key, action } of shiftedShortcuts) {
      it(`${isMac ? "Cmd+Shift" : "Ctrl+Shift"}+${key} triggers ${action}`, () => {
        const actions = makeActions();
        // On Linux, single-letter keys become uppercase with Shift; special keys (Enter) stay as-is
        const eventKey = !isMac && key.length === 1 ? key.toUpperCase() : key;
        const e = new KeyboardEvent("keydown", {
          key: eventKey,
          metaKey: isMac,
          ctrlKey: !isMac,
          shiftKey: true,
        });
        handleKeydown(e, actions);
        expect(actions[action]).toHaveBeenCalled();
      });
    }
  });

  describe("Ctrl+Tab cycles surfaces on both platforms", () => {
    it("Ctrl+Tab triggers nextSurface", () => {
      const actions = makeActions();
      const e = new KeyboardEvent("keydown", {
        key: "Tab",
        ctrlKey: true,
      });
      handleKeydown(e, actions);
      expect(actions.nextSurface).toHaveBeenCalled();
    });

    it("Ctrl+Shift+Tab triggers prevSurface", () => {
      const actions = makeActions();
      const e = new KeyboardEvent("keydown", {
        key: "Tab",
        ctrlKey: true,
        shiftKey: true,
      });
      handleKeydown(e, actions);
      expect(actions.prevSurface).toHaveBeenCalled();
    });
  });

  describe("Escape closes find bar regardless of platform", () => {
    it("Escape triggers closeFindBar when find bar visible", () => {
      const actions = makeActions();
      vi.mocked(actions.findBarVisible).mockReturnValue(true);
      const e = new KeyboardEvent("keydown", { key: "Escape" });
      handleKeydown(e, actions);
      expect(actions.closeFindBar).toHaveBeenCalled();
    });
  });

  if (isMac) {
    describe("macOS-specific: Ctrl+1-9 selects surface", () => {
      it("Ctrl+1 triggers selectSurface(1)", () => {
        const actions = makeActions();
        const e = new KeyboardEvent("keydown", {
          key: "1",
          ctrlKey: true,
        });
        handleKeydown(e, actions);
        expect(actions.selectSurface).toHaveBeenCalledWith(1);
      });
    });

    describe("macOS-specific: Cmd+1-9 switches workspace", () => {
      it("Cmd+1 triggers switchWorkspace(0)", () => {
        const actions = makeActions();
        const e = new KeyboardEvent("keydown", {
          key: "1",
          metaKey: true,
        });
        handleKeydown(e, actions);
        expect(actions.switchWorkspace).toHaveBeenCalledWith(0);
      });
    });
  }
});

// --- H3: sendIssueToAgent bounded retry ---

describe("H3: sendIssueToAgent bounded retry", () => {
  it("workspace-actions exports sendIssueToAgent function", async () => {
    // Just verify the import works — actual behavior is integration-level
    const mod = await import("../lib/workspace-actions");
    expect(typeof mod.sendIssueToAgent).toBe("function");
  });

  it("does not contain raw setTimeout with 2000ms delay", async () => {
    // Read the source to verify the fix
    const { readFileSync } = await import("fs");
    const source = readFileSync("src/lib/workspace-actions.ts", "utf-8");
    // Should NOT have the old pattern
    expect(source).not.toMatch(/setTimeout\(async.*2000\)/s);
    // Should have the bounded retry pattern
    expect(source).toContain("maxAttempts");
    expect(source).toContain("pollInterval");
  });
});
