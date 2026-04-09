/**
 * Harness system tests — createHarnessSurface, status detection, settings.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must come before any source imports
// ---------------------------------------------------------------------------

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
  Terminal: vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    write: vi.fn(),
    focus: vi.fn(),
    dispose: vi.fn(),
    onData: vi.fn(),
    onResize: vi.fn(),
    onTitleChange: vi.fn(),
    loadAddon: vi.fn(),
    options: {},
    cols: 80,
    rows: 24,
    buffer: { active: { getLine: vi.fn() } },
    parser: { registerOscHandler: vi.fn() },
    attachCustomKeyEventHandler: vi.fn(),
    registerLinkProvider: vi.fn(),
    getSelection: vi.fn(),
    scrollToBottom: vi.fn(),
    clear: vi.fn(),
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

// ---------------------------------------------------------------------------
// Source imports (after mocks)
// ---------------------------------------------------------------------------

import type {
  Pane,
  HarnessSurface,
  HarnessPreset,
  AgentStatus,
} from "../lib/types";
import { uid, isHarnessSurface, isTerminalSurface } from "../lib/types";
import { createHarnessSurface } from "../lib/terminal-service";
import { getSettings } from "../lib/settings";
import type { Settings } from "../lib/settings";
import {
  parseStatusFromTitle,
  createHarnessStatusTracker,
  type HarnessStatusTracker,
} from "../lib/harness-status";
import {
  render,
  screen,
  cleanup as testingCleanup,
} from "@testing-library/svelte";
import TabBar from "../lib/components/TabBar.svelte";
import Tab from "../lib/components/Tab.svelte";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePane(): Pane {
  return {
    id: uid(),
    surfaces: [],
    activeSurfaceId: null,
  };
}

// Inject harness presets into config for testing
function setTestConfig(overrides: Partial<Settings>) {
  const config = getSettings();
  Object.assign(config, overrides);
}

// ===========================================================================
// createHarnessSurface
// ===========================================================================

describe("createHarnessSurface", () => {
  const testPresets: HarnessPreset[] = [
    {
      id: "claude",
      name: "Claude Code",
      command: "claude",
      args: ["--interactive"],
      env: { CLAUDE_MODEL: "opus" },
    },
    {
      id: "copilot",
      name: "Copilot",
      command: "gh",
      args: ["copilot"],
    },
  ];

  beforeEach(() => {
    setTestConfig({ harnesses: testPresets });
  });

  it("creates a HarnessSurface with kind 'harness'", async () => {
    const pane = makePane();
    const surface = await createHarnessSurface(pane, "claude");
    expect(surface.kind).toBe("harness");
  });

  it("sets presetId from the provided preset", async () => {
    const pane = makePane();
    const surface = await createHarnessSurface(pane, "claude");
    expect(surface.presetId).toBe("claude");
  });

  it("initializes status as 'idle'", async () => {
    const pane = makePane();
    const surface = await createHarnessSurface(pane, "claude");
    expect(surface.status).toBe("idle");
  });

  it("uses 'Harness' as initial title", async () => {
    const pane = makePane();
    const surface = await createHarnessSurface(pane, "claude");
    expect(surface.title).toBe("Harness");
  });

  it("passes the isHarnessSurface type guard", async () => {
    const pane = makePane();
    const surface = await createHarnessSurface(pane, "claude");
    expect(isHarnessSurface(surface)).toBe(true);
    expect(isTerminalSurface(surface)).toBe(false);
  });

  it("pushes the surface into pane.surfaces", async () => {
    const pane = makePane();
    await createHarnessSurface(pane, "claude");
    expect(pane.surfaces.length).toBe(1);
    expect(pane.surfaces[0].kind).toBe("harness");
  });

  it("sets pane.activeSurfaceId to the new surface", async () => {
    const pane = makePane();
    const surface = await createHarnessSurface(pane, "claude");
    expect(pane.activeSurfaceId).toBe(surface.id);
  });

  it("creates a terminal instance", async () => {
    const pane = makePane();
    const surface = await createHarnessSurface(pane, "claude");
    expect(surface.terminal).toBeDefined();
    expect(surface.fitAddon).toBeDefined();
    expect(surface.searchAddon).toBeDefined();
    expect(surface.termElement).toBeInstanceOf(HTMLElement);
  });

  it("starts with ptyId = -1 (connected later via connectPty)", async () => {
    const pane = makePane();
    const surface = await createHarnessSurface(pane, "claude");
    expect(surface.ptyId).toBe(-1);
  });

  it("respects cwd parameter", async () => {
    const pane = makePane();
    const surface = await createHarnessSurface(pane, "claude", "/tmp/project");
    expect(surface.cwd).toBe("/tmp/project");
  });

  it("throws when preset is not found", async () => {
    const pane = makePane();
    await expect(createHarnessSurface(pane, "nonexistent")).rejects.toThrow(
      /preset.*not found/i,
    );
  });

  it("sets hasUnread to false and opened to false", async () => {
    const pane = makePane();
    const surface = await createHarnessSurface(pane, "claude");
    expect(surface.hasUnread).toBe(false);
    expect(surface.opened).toBe(false);
  });

  it("sets startupCommand from preset command and args", async () => {
    const pane = makePane();
    const surface = await createHarnessSurface(pane, "claude");
    expect(surface.startupCommand).toBe("claude --interactive");
  });

  it("joins command and args for startupCommand", async () => {
    // Add a preset with args to test joining
    const { getSettings } = await import("../lib/settings");
    const settings = getSettings();
    settings.harnesses.push({
      id: "claude-plan",
      name: "Claude Plan",
      command: "claude",
      args: ["--permission-mode", "plan"],
      env: {},
    });

    const pane = makePane();
    const surface = await createHarnessSurface(pane, "claude-plan");
    expect(surface.startupCommand).toBe("claude --permission-mode plan");

    // Clean up
    settings.harnesses.pop();
  });
});

// ===========================================================================
// parseStatusFromTitle (Layer 2 — Title parsing)
// ===========================================================================

describe("parseStatusFromTitle", () => {
  it("returns 'running' for 'Thinking...'", () => {
    expect(parseStatusFromTitle("Thinking...")).toBe("running");
  });

  it("returns 'running' for 'Working...'", () => {
    expect(parseStatusFromTitle("Working...")).toBe("running");
  });

  it("returns 'running' for 'Starting...'", () => {
    expect(parseStatusFromTitle("Starting...")).toBe("running");
  });

  it("returns 'waiting' for 'Waiting...'", () => {
    expect(parseStatusFromTitle("Waiting...")).toBe("waiting");
  });

  it("returns 'waiting' for 'Waiting for input...'", () => {
    expect(parseStatusFromTitle("Waiting for input...")).toBe("waiting");
  });

  it("returns 'idle' for 'Ready'", () => {
    expect(parseStatusFromTitle("Ready")).toBe("idle");
  });

  it("returns null for unrecognized titles", () => {
    expect(parseStatusFromTitle("my-project")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseStatusFromTitle("")).toBeNull();
  });

  it("is case insensitive", () => {
    expect(parseStatusFromTitle("THINKING...")).toBe("running");
    expect(parseStatusFromTitle("waiting...")).toBe("waiting");
    expect(parseStatusFromTitle("ready")).toBe("idle");
  });

  it("matches titles that contain the keyword", () => {
    expect(parseStatusFromTitle("Claude: Thinking...")).toBe("running");
    expect(parseStatusFromTitle("Agent: Waiting for response")).toBe("waiting");
  });
});

// ===========================================================================
// HarnessStatusTracker (Layer 3 — Process state + integration)
// ===========================================================================

describe("HarnessStatusTracker", () => {
  function makeHarnessSurface(
    overrides: Partial<HarnessSurface> = {},
  ): HarnessSurface {
    return {
      kind: "harness",
      id: uid(),
      terminal: {} as any,
      fitAddon: {} as any,
      searchAddon: {} as any,
      termElement: document.createElement("div"),
      ptyId: 42,
      title: "Claude Code",
      hasUnread: false,
      opened: true,
      presetId: "claude",
      status: "idle",
      ...overrides,
    };
  }

  let tracker: HarnessStatusTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    tracker = createHarnessStatusTracker({ idleThresholdMs: 1000 });
  });

  afterEach(() => {
    tracker.dispose();
    vi.useRealTimers();
  });

  it("sets status to 'waiting' on OSC notification (Layer 1)", () => {
    const surface = makeHarnessSurface();
    tracker.register(surface);
    tracker.handleNotification(surface.ptyId, "Build complete");
    expect(surface.status).toBe("waiting");
  });

  it("sets status from title parsing (Layer 2)", () => {
    const surface = makeHarnessSurface();
    tracker.register(surface);
    tracker.handleTitle(surface.ptyId, "Thinking...");
    expect(surface.status).toBe("running");
  });

  it("sets status to 'idle' after idle threshold (Layer 3)", () => {
    const surface = makeHarnessSurface({ status: "running" });
    tracker.register(surface);
    tracker.handleOutput(surface.ptyId);
    // Advance time past idle threshold
    vi.advanceTimersByTime(1100);
    expect(surface.status).toBe("idle");
  });

  it("resets idle timer on new output", () => {
    const surface = makeHarnessSurface({ status: "running" });
    tracker.register(surface);
    tracker.handleOutput(surface.ptyId);
    // Advance half the threshold
    vi.advanceTimersByTime(500);
    expect(surface.status).toBe("running");
    // New output resets the timer
    tracker.handleOutput(surface.ptyId);
    vi.advanceTimersByTime(500);
    expect(surface.status).toBe("running");
    // Now advance past the full threshold from last output
    vi.advanceTimersByTime(600);
    expect(surface.status).toBe("idle");
  });

  it("sets 'exited' on pty-exit with code 0", () => {
    const surface = makeHarnessSurface();
    tracker.register(surface);
    tracker.handleExit(surface.ptyId, 0);
    expect(surface.status).toBe("exited");
  });

  it("sets 'error' on pty-exit with non-zero code", () => {
    const surface = makeHarnessSurface();
    tracker.register(surface);
    tracker.handleExit(surface.ptyId, 1);
    expect(surface.status).toBe("error");
  });

  it("OSC notification overrides title-based status", () => {
    const surface = makeHarnessSurface();
    tracker.register(surface);
    // Title says running
    tracker.handleTitle(surface.ptyId, "Thinking...");
    expect(surface.status).toBe("running");
    // OSC notification overrides to waiting
    tracker.handleNotification(surface.ptyId, "Done!");
    expect(surface.status).toBe("waiting");
  });

  it("title parsing overrides process state", () => {
    const surface = makeHarnessSurface({ status: "idle" });
    tracker.register(surface);
    tracker.handleTitle(surface.ptyId, "Working...");
    expect(surface.status).toBe("running");
  });

  it("ignores events for unregistered ptyIds", () => {
    const surface = makeHarnessSurface();
    tracker.register(surface);
    // These should not throw
    tracker.handleNotification(999, "test");
    tracker.handleTitle(999, "Thinking...");
    tracker.handleOutput(999);
    tracker.handleExit(999, 0);
    // Surface should be unchanged
    expect(surface.status).toBe("idle");
  });

  it("unregister removes tracking", () => {
    const surface = makeHarnessSurface();
    tracker.register(surface);
    tracker.unregister(surface.ptyId);
    tracker.handleNotification(surface.ptyId, "test");
    expect(surface.status).toBe("idle");
  });

  it("calls onChange callback when status changes", () => {
    const onChange = vi.fn();
    tracker = createHarnessStatusTracker({ idleThresholdMs: 1000, onChange });
    const surface = makeHarnessSurface();
    tracker.register(surface);
    tracker.handleTitle(surface.ptyId, "Thinking...");
    expect(onChange).toHaveBeenCalledWith(surface.ptyId, "running");
  });

  it("does not call onChange when status stays the same", () => {
    const onChange = vi.fn();
    tracker = createHarnessStatusTracker({ idleThresholdMs: 1000, onChange });
    const surface = makeHarnessSurface({ status: "running" });
    tracker.register(surface);
    tracker.handleTitle(surface.ptyId, "Thinking...");
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// TabBar — harness/terminal separation and status dots
// ===========================================================================

describe("TabBar harness UI", () => {
  const noop = () => {};

  function makeTermSurface(
    id: string,
    title: string,
  ): import("../lib/types").TerminalSurface {
    return {
      kind: "terminal",
      id,
      terminal: {
        focus: vi.fn(),
        open: vi.fn(),
        dispose: vi.fn(),
        scrollToBottom: vi.fn(),
        write: vi.fn(),
        onData: vi.fn(),
        onResize: vi.fn(),
        onTitleChange: vi.fn(),
        loadAddon: vi.fn(),
        options: {},
        buffer: { active: { getLine: vi.fn() } },
        parser: { registerOscHandler: vi.fn() },
        attachCustomKeyEventHandler: vi.fn(),
        registerLinkProvider: vi.fn(),
        getSelection: vi.fn(),
      } as any,
      fitAddon: { fit: vi.fn() } as any,
      searchAddon: {
        findNext: vi.fn(),
        findPrevious: vi.fn(),
        clearDecorations: vi.fn(),
      } as any,
      termElement: document.createElement("div"),
      ptyId: 1,
      title,
      hasUnread: false,
      opened: true,
    };
  }

  function makeHarnessTab(
    id: string,
    title: string,
    status: AgentStatus = "idle",
  ): HarnessSurface {
    return {
      kind: "harness",
      id,
      terminal: {
        focus: vi.fn(),
        open: vi.fn(),
        dispose: vi.fn(),
        scrollToBottom: vi.fn(),
        write: vi.fn(),
        onData: vi.fn(),
        onResize: vi.fn(),
        onTitleChange: vi.fn(),
        loadAddon: vi.fn(),
        options: {},
        buffer: { active: { getLine: vi.fn() } },
        parser: { registerOscHandler: vi.fn() },
        attachCustomKeyEventHandler: vi.fn(),
        registerLinkProvider: vi.fn(),
        getSelection: vi.fn(),
      } as any,
      fitAddon: { fit: vi.fn() } as any,
      searchAddon: {
        findNext: vi.fn(),
        findPrevious: vi.fn(),
        clearDecorations: vi.fn(),
      } as any,
      termElement: document.createElement("div"),
      ptyId: 2,
      title,
      hasUnread: false,
      opened: true,
      presetId: "claude",
      status,
    };
  }

  beforeEach(() => {
    testingCleanup();
  });

  it("renders all tabs in natural order (unified tab bar)", () => {
    const harness = makeHarnessTab("h1", "Claude Code");
    const term = makeTermSurface("t1", "Shell 1");
    const pane: Pane = {
      id: "p1",
      surfaces: [term, harness],
      activeSurfaceId: term.id,
    };
    const { container } = render(TabBar, {
      props: {
        pane,
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: noop,
      },
    });
    const tabs = container.querySelectorAll(".tab");
    expect(tabs.length).toBe(2);
    expect(tabs[0].textContent).toContain("Shell 1");
    expect(tabs[1].textContent).toContain("Claude Code");
  });

  it("shows a status dot for harness surfaces", () => {
    const harness = makeHarnessTab("h1", "Claude Code", "running");
    const pane: Pane = {
      id: "p1",
      surfaces: [harness],
      activeSurfaceId: harness.id,
    };
    const { container } = render(TabBar, {
      props: {
        pane,
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: noop,
      },
    });
    const dot = container.querySelector("[data-status-dot]");
    expect(dot).toBeTruthy();
  });

  it("does not render divider (unified tab bar)", () => {
    const harness = makeHarnessTab("h1", "Claude Code");
    const term = makeTermSurface("t1", "Shell 1");
    const pane: Pane = {
      id: "p1",
      surfaces: [harness, term],
      activeSurfaceId: harness.id,
    };
    const { container } = render(TabBar, {
      props: {
        pane,
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: noop,
      },
    });
    const divider = container.querySelector("[data-tab-divider]");
    expect(divider).toBeNull();
  });
});
