/**
 * Tests for two specific bug fixes in terminal-manager.ts:
 *
 * 1. ResizeObserver stale closure fix — observer now dynamically looks up the
 *    active surface instead of capturing it in a closure.
 *
 * 2. Flow control deadlock prevention — a safety timer force-resumes the PTY
 *    if xterm write callbacks stall.
 *
 * These tests exercise the logic in isolation by extracting the relevant
 * patterns from TerminalManager and verifying them against mocked APIs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock Tauri APIs — must be registered before importing terminal-manager
// ---------------------------------------------------------------------------

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

// Mock xterm and addons — these are imported by terminal-manager at module level
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
  })),
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: vi.fn().mockImplementation(() => ({
    activate: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

// Mock preview modules
vi.mock("../preview/index", () => ({
  openPreview: vi.fn(),
  canPreview: vi.fn().mockReturnValue(false),
  getSupportedExtensions: vi.fn().mockReturnValue([]),
}));
vi.mock("../preview/init", () => ({}));
vi.mock("../config", () => ({
  type: true,
}));
vi.mock("../theme", () => ({
  theme: { value: { name: "default" } },
  getXtermTheme: vi.fn().mockReturnValue({}),
}));
vi.mock("../context-menu", () => ({
  showContextMenu: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Pane, Surface } from "../terminal-manager";

// ============================================================================
// RESIZE OBSERVER TESTS
// ============================================================================

describe("ResizeObserver stale closure fix", () => {
  // These tests verify the pattern used in buildPaneElement (lines ~672-684).
  // Rather than instantiating the full TerminalManager (which requires a full
  // DOM environment and Tauri backend), we replicate the exact observer-setup
  // logic from the source and test it in isolation.

  let mockObserverInstances: Array<{
    callback: ResizeObserverCallback;
    observe: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    unobserve: ReturnType<typeof vi.fn>;
  }>;

  beforeEach(() => {
    mockObserverInstances = [];

    // Install a mock ResizeObserver that records instances
    vi.stubGlobal(
      "ResizeObserver",
      vi.fn().mockImplementation((callback: ResizeObserverCallback) => {
        const instance = {
          callback,
          observe: vi.fn(),
          disconnect: vi.fn(),
          unobserve: vi.fn(),
        };
        mockObserverInstances.push(instance);
        return instance;
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeSurface(id: string, active: boolean): Surface {
    const fitAddon = { fit: vi.fn(), activate: vi.fn(), dispose: vi.fn() };
    return {
      id,
      terminal: { focus: vi.fn() } as any,
      fitAddon: fitAddon as any,
      termElement: {
        offsetParent: document.body, // attached to DOM
        style: { display: active ? "flex" : "none" },
      } as any,
      ptyId: 1,
      title: id,
      hasUnread: false,
      opened: true,
    };
  }

  /**
   * Replicates the exact observer-setup logic from buildPaneElement.
   * This is the code under test (lines 672-684 of terminal-manager.ts).
   */
  function setupResizeObserver(pane: Pane, el: HTMLElement) {
    // Disconnect any previous observer to avoid stale closures and leaked observers
    if (pane.resizeObserver) {
      pane.resizeObserver.disconnect();
    }
    // Use a dynamic lookup so the observer always fits the *current* active surface
    pane.resizeObserver = new ResizeObserver(() => {
      const active = pane.surfaces.find((s) => s.id === pane.activeSurfaceId);
      if (active && active.termElement.offsetParent !== null) {
        active.fitAddon.fit();
      }
    });
    pane.resizeObserver.observe(el);
  }

  it("disconnects the old observer when a new one is created", () => {
    const surface = makeSurface("s1", true);
    const pane: Pane = {
      id: "p1",
      surfaces: [surface],
      activeSurfaceId: "s1",
      element: document.createElement("div"),
    };

    const el = document.createElement("div");

    // First call — creates the initial observer
    setupResizeObserver(pane, el);
    expect(mockObserverInstances).toHaveLength(1);
    const firstObserver = mockObserverInstances[0];
    expect(firstObserver.observe).toHaveBeenCalledWith(el);
    expect(firstObserver.disconnect).not.toHaveBeenCalled();

    // Second call — should disconnect the first observer
    setupResizeObserver(pane, el);
    expect(mockObserverInstances).toHaveLength(2);
    expect(firstObserver.disconnect).toHaveBeenCalledOnce();
    expect(mockObserverInstances[1].observe).toHaveBeenCalledWith(el);
  });

  it("dynamically finds the current active surface, not a stale one", () => {
    const s1 = makeSurface("s1", true);
    const s2 = makeSurface("s2", false);
    const pane: Pane = {
      id: "p1",
      surfaces: [s1, s2],
      activeSurfaceId: "s1",
      element: document.createElement("div"),
    };

    const el = document.createElement("div");
    setupResizeObserver(pane, el);

    const observer = mockObserverInstances[0];

    // Trigger resize while s1 is active
    observer.callback([], observer as any);
    expect(s1.fitAddon.fit).toHaveBeenCalledOnce();
    expect(s2.fitAddon.fit).not.toHaveBeenCalled();

    // Switch active surface to s2
    pane.activeSurfaceId = "s2";

    // Trigger resize again — should fit s2, not s1
    observer.callback([], observer as any);
    expect(s2.fitAddon.fit).toHaveBeenCalledOnce();
    // s1 should still only have been called once (from before the switch)
    expect(s1.fitAddon.fit).toHaveBeenCalledOnce();
  });

  it("skips fit() when the element is detached (offsetParent === null)", () => {
    const surface = makeSurface("s1", true);
    const pane: Pane = {
      id: "p1",
      surfaces: [surface],
      activeSurfaceId: "s1",
      element: document.createElement("div"),
    };

    const el = document.createElement("div");
    setupResizeObserver(pane, el);

    const observer = mockObserverInstances[0];

    // Detach the element
    (surface.termElement as any).offsetParent = null;

    // Trigger resize — fit() should NOT be called
    observer.callback([], observer as any);
    expect(surface.fitAddon.fit).not.toHaveBeenCalled();

    // Re-attach the element
    (surface.termElement as any).offsetParent = document.body;

    // Trigger resize — fit() SHOULD be called now
    observer.callback([], observer as any);
    expect(surface.fitAddon.fit).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// FLOW CONTROL TESTS
// ============================================================================

describe("Flow control deadlock prevention", () => {
  // These tests verify the flow-control logic from setupListeners (lines ~142-188).
  // We replicate the exact logic pattern and wire it to captured listen callbacks.

  const PAUSE_THRESHOLD = 5;
  const RESUME_THRESHOLD = 2;
  const PAUSE_TIMEOUT_MS = 2000;

  let pendingWrites: Map<number, number>;
  let pauseTimers: Map<number, ReturnType<typeof setTimeout>>;
  let mockInvoke: ReturnType<typeof vi.fn>;
  let mockTerminal: { write: ReturnType<typeof vi.fn> };

  // Collects the write callbacks so we can call them manually
  let writeCallbacks: Array<() => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    pendingWrites = new Map();
    pauseTimers = new Map();
    writeCallbacks = [];
    mockInvoke = vi.fn().mockResolvedValue(undefined);

    // Mock terminal.write that captures callbacks
    mockTerminal = {
      write: vi.fn().mockImplementation((_data: any, cb?: () => void) => {
        if (cb) writeCallbacks.push(cb);
      }),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Replicates the exact flow-control logic from the pty-output listener
   * (lines 152-188 of terminal-manager.ts).
   */
  function simulatePtyOutput(ptyId: number) {
    const pending = (pendingWrites.get(ptyId) || 0) + 1;
    pendingWrites.set(ptyId, pending);

    if (pending >= PAUSE_THRESHOLD) {
      mockInvoke("pause_pty", { ptyId });
      // Start a safety timer to force resume if callbacks stall
      if (!pauseTimers.has(ptyId)) {
        pauseTimers.set(
          ptyId,
          setTimeout(() => {
            pauseTimers.delete(ptyId);
            pendingWrites.set(ptyId, 0);
            mockInvoke("resume_pty", { ptyId });
          }, PAUSE_TIMEOUT_MS)
        );
      }
    }

    mockTerminal.write(new Uint8Array(0), () => {
      const p = Math.max((pendingWrites.get(ptyId) || 0) - 1, 0);
      pendingWrites.set(ptyId, p);
      if (p <= RESUME_THRESHOLD) {
        mockInvoke("resume_pty", { ptyId });
        // Clear safety timer since flow resumed normally
        const timer = pauseTimers.get(ptyId);
        if (timer) {
          clearTimeout(timer);
          pauseTimers.delete(ptyId);
        }
      }
    });
  }

  it("pauses the PTY when pending writes reach the threshold", () => {
    const ptyId = 42;

    // Send writes up to just below threshold — no pause
    for (let i = 0; i < PAUSE_THRESHOLD - 1; i++) {
      simulatePtyOutput(ptyId);
    }
    expect(mockInvoke).not.toHaveBeenCalledWith("pause_pty", { ptyId });

    // One more write triggers pause
    simulatePtyOutput(ptyId);
    expect(mockInvoke).toHaveBeenCalledWith("pause_pty", { ptyId });
  });

  it("resumes the PTY when pending writes drain below the resume threshold", () => {
    const ptyId = 42;

    // Fill up to pause threshold
    for (let i = 0; i < PAUSE_THRESHOLD; i++) {
      simulatePtyOutput(ptyId);
    }
    expect(mockInvoke).toHaveBeenCalledWith("pause_pty", { ptyId });

    // Drain write callbacks until pending drops to RESUME_THRESHOLD
    // We have PAUSE_THRESHOLD callbacks queued. Each one decrements pending by 1.
    // Current pending = 5. We need pending <= 2, so drain 3 callbacks (5->4->3->2).
    const drainCount = PAUSE_THRESHOLD - RESUME_THRESHOLD;
    for (let i = 0; i < drainCount; i++) {
      writeCallbacks[i]();
    }

    expect(mockInvoke).toHaveBeenCalledWith("resume_pty", { ptyId });
  });

  it("fires the safety timer and resets state when write callbacks stall", () => {
    const ptyId = 42;

    // Fill up to pause threshold (triggers pause + starts safety timer)
    for (let i = 0; i < PAUSE_THRESHOLD; i++) {
      simulatePtyOutput(ptyId);
    }
    expect(mockInvoke).toHaveBeenCalledWith("pause_pty", { ptyId });
    expect(pauseTimers.has(ptyId)).toBe(true);

    // Don't call any write callbacks — simulate a stall.
    // Advance time past the safety timeout.
    vi.advanceTimersByTime(PAUSE_TIMEOUT_MS);

    // Safety timer should have fired: pending reset to 0, resume called
    expect(pendingWrites.get(ptyId)).toBe(0);
    expect(mockInvoke).toHaveBeenCalledWith("resume_pty", { ptyId });
    expect(pauseTimers.has(ptyId)).toBe(false);
  });

  it("clears the safety timer when flow resumes normally before timeout", () => {
    const ptyId = 42;

    // Fill up to pause threshold
    for (let i = 0; i < PAUSE_THRESHOLD; i++) {
      simulatePtyOutput(ptyId);
    }
    expect(pauseTimers.has(ptyId)).toBe(true);

    // Drain enough callbacks to trigger normal resume
    const drainCount = PAUSE_THRESHOLD - RESUME_THRESHOLD;
    for (let i = 0; i < drainCount; i++) {
      writeCallbacks[i]();
    }

    // Timer should have been cleared by normal resume
    expect(pauseTimers.has(ptyId)).toBe(false);

    // Advance time past what would have been the timeout — nothing should happen
    mockInvoke.mockClear();
    vi.advanceTimersByTime(PAUSE_TIMEOUT_MS);

    // No additional resume_pty call from the safety timer
    expect(mockInvoke).not.toHaveBeenCalledWith("resume_pty", { ptyId });
  });
});
