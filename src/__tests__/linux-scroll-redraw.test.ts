/**
 * Linux scroll/redraw loop regression tests (#46)
 *
 * On Linux (WebKitGTK), PTY output can trigger spurious ResizeObserver
 * callbacks, creating a fit() → resize_pty → SIGWINCH → redraw loop that
 * yanks the viewport to the top. These tests verify:
 *
 * 1. resize_pty dedup — onResize skips invoke when cols/rows haven't changed
 * 2. shouldFit — skips fit() when container pixel dimensions are unchanged
 * 3. Scroll anchor — onScroll interception prevents auto-scroll during writes
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { invoke } from "@tauri-apps/api/core";

// ---------------------------------------------------------------------------
// 1. resize_pty deduplication
// ---------------------------------------------------------------------------

describe("resize_pty deduplication (#46)", () => {
  let mockInvoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockInvoke = invoke as ReturnType<typeof vi.fn>;
    mockInvoke.mockClear();
  });

  it("calls resize_pty on first resize", async () => {
    const { createResizeHandler } = await import("../lib/resize-guard");
    const handler = createResizeHandler(() => 1);
    handler({ cols: 80, rows: 24 });
    expect(mockInvoke).toHaveBeenCalledWith("resize_pty", { ptyId: 1, cols: 80, rows: 24 });
  });

  it("skips resize_pty when cols/rows are unchanged", async () => {
    const { createResizeHandler } = await import("../lib/resize-guard");
    const handler = createResizeHandler(() => 1);
    handler({ cols: 80, rows: 24 });
    mockInvoke.mockClear();
    handler({ cols: 80, rows: 24 });
    expect(mockInvoke).not.toHaveBeenCalledWith("resize_pty", expect.anything());
  });

  it("calls resize_pty when dimensions actually change", async () => {
    const { createResizeHandler } = await import("../lib/resize-guard");
    const handler = createResizeHandler(() => 1);
    handler({ cols: 80, rows: 24 });
    mockInvoke.mockClear();
    handler({ cols: 120, rows: 36 });
    expect(mockInvoke).toHaveBeenCalledWith("resize_pty", { ptyId: 1, cols: 120, rows: 36 });
  });

  it("skips resize_pty when ptyId is negative (not connected)", async () => {
    const { createResizeHandler } = await import("../lib/resize-guard");
    const handler = createResizeHandler(() => -1);
    handler({ cols: 80, rows: 24 });
    expect(mockInvoke).not.toHaveBeenCalledWith("resize_pty", expect.anything());
  });
});

// ---------------------------------------------------------------------------
// 2. PaneView fitActiveTerminal dimension guard
// ---------------------------------------------------------------------------

describe("fitActiveTerminal dimension guard (#46)", () => {
  it("skips fit() when container pixel dimensions are unchanged", async () => {
    const { shouldFit } = await import("../lib/resize-guard");
    const state = { lastWidth: 0, lastHeight: 0 };

    expect(shouldFit(800, 600, state)).toBe(true);
    expect(state.lastWidth).toBe(800);
    expect(state.lastHeight).toBe(600);

    expect(shouldFit(800, 600, state)).toBe(false);
    expect(shouldFit(900, 600, state)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Scroll anchor — onScroll interception
// ---------------------------------------------------------------------------

describe("Scroll anchor (#46)", () => {
  it("detects when terminal is at the bottom of scrollback", async () => {
    const { isScrolledToBottom } = await import("../lib/resize-guard");

    const mockTerminal = {
      buffer: { active: { baseY: 100, viewportY: 100 } },
      rows: 24,
    };

    expect(isScrolledToBottom(mockTerminal as any)).toBe(true);

    mockTerminal.buffer.active.viewportY = 50;
    expect(isScrolledToBottom(mockTerminal as any)).toBe(false);
  });

  it("considers viewport at bottom when within 1 row tolerance", async () => {
    const { isScrolledToBottom } = await import("../lib/resize-guard");

    const mockTerminal = {
      buffer: { active: { baseY: 100, viewportY: 99 } },
      rows: 24,
    };

    expect(isScrolledToBottom(mockTerminal as any)).toBe(true);
  });

  it("getScrollAnchor returns null when no anchor set", async () => {
    const { getScrollAnchor, clearScrollAnchor } = await import("../lib/resize-guard");
    clearScrollAnchor(99);
    expect(getScrollAnchor(99)).toBeNull();
  });

  it("clearScrollAnchor removes anchor for a ptyId", async () => {
    const mod = await import("../lib/resize-guard");
    mod.clearScrollAnchor(42);
    expect(mod.getScrollAnchor(42)).toBeNull();
  });

  it("markWriteStart/markWriteEnd lifecycle", async () => {
    // These should not throw and should be idempotent
    const { markWriteStart, markWriteEnd } = await import("../lib/resize-guard");
    markWriteStart(1);
    markWriteStart(1); // double-start is safe (Set)
    markWriteEnd(1);
    markWriteEnd(1); // double-end is safe
  });

  it("setupScrollAnchor registers onScroll handler on terminal", async () => {
    const { setupScrollAnchor } = await import("../lib/resize-guard");

    const onScrollHandler = vi.fn();
    const mockTerminal = {
      onScroll: onScrollHandler,
      buffer: { active: { baseY: 0, viewportY: 0 } },
      scrollToLine: vi.fn(),
    };

    setupScrollAnchor(mockTerminal as any, () => 1);
    expect(onScrollHandler).toHaveBeenCalledTimes(1);
    expect(typeof onScrollHandler.mock.calls[0][0]).toBe("function");
  });

  it("onScroll handler updates anchor on user scroll (no write in-flight)", async () => {
    const mod = await import("../lib/resize-guard");

    // Set up a mock terminal with onScroll that captures the handler
    let scrollHandler: (() => void) | null = null;
    const mockTerminal = {
      onScroll: (fn: () => void) => { scrollHandler = fn; },
      buffer: { active: { baseY: 100, viewportY: 50 } },
      scrollToLine: vi.fn(),
    };

    mod.clearScrollAnchor(10);
    mod.markWriteEnd(10); // ensure no write in-flight
    mod.setupScrollAnchor(mockTerminal as any, () => 10);

    // Simulate user scroll (no write in-flight) to non-bottom position
    scrollHandler!();
    expect(mod.getScrollAnchor(10)).toBe(50);

    // Simulate user scroll to bottom
    mockTerminal.buffer.active.viewportY = 100;
    scrollHandler!();
    expect(mod.getScrollAnchor(10)).toBeNull();

    mod.clearScrollAnchor(10);
  });

  it("onScroll handler counteracts auto-scroll during write", async () => {
    const mod = await import("../lib/resize-guard");

    let scrollHandler: (() => void) | null = null;
    const mockTerminal = {
      onScroll: (fn: () => void) => { scrollHandler = fn; },
      buffer: { active: { baseY: 200, viewportY: 200 } },
      scrollToLine: vi.fn(),
    };

    const ptyId = 20;
    mod.clearScrollAnchor(ptyId);
    mod.setupScrollAnchor(mockTerminal as any, () => ptyId);

    // Simulate: user scrolled up, anchor is at line 50
    mockTerminal.buffer.active.viewportY = 50;
    scrollHandler!(); // user scroll sets anchor
    expect(mod.getScrollAnchor(ptyId)).toBe(50);

    // Now simulate: write starts, xterm auto-scrolls to bottom
    mod.markWriteStart(ptyId);
    mockTerminal.buffer.active.viewportY = 200; // xterm auto-scrolled
    scrollHandler!(); // onScroll fires during write

    // Should have called scrollToLine to restore anchor
    expect(mockTerminal.scrollToLine).toHaveBeenCalledWith(50);

    mod.markWriteEnd(ptyId);
    mod.clearScrollAnchor(ptyId);
  });

  it("onScroll handler does not counteract when no anchor set", async () => {
    const mod = await import("../lib/resize-guard");

    let scrollHandler: (() => void) | null = null;
    const mockTerminal = {
      onScroll: (fn: () => void) => { scrollHandler = fn; },
      buffer: { active: { baseY: 100, viewportY: 100 } },
      scrollToLine: vi.fn(),
    };

    const ptyId = 30;
    mod.clearScrollAnchor(ptyId);
    mod.setupScrollAnchor(mockTerminal as any, () => ptyId);

    // Write in-flight but no anchor → auto-scroll should pass through
    mod.markWriteStart(ptyId);
    scrollHandler!();
    expect(mockTerminal.scrollToLine).not.toHaveBeenCalled();

    mod.markWriteEnd(ptyId);
  });

  it("caps anchor at baseY when scrollback has been trimmed", async () => {
    const mod = await import("../lib/resize-guard");

    let scrollHandler: (() => void) | null = null;
    const mockTerminal = {
      onScroll: (fn: () => void) => { scrollHandler = fn; },
      buffer: { active: { baseY: 200, viewportY: 150 } },
      scrollToLine: vi.fn(),
    };

    const ptyId = 40;
    mod.clearScrollAnchor(ptyId);
    mod.setupScrollAnchor(mockTerminal as any, () => ptyId);

    // User scrolls to line 150
    scrollHandler!();
    expect(mod.getScrollAnchor(ptyId)).toBe(150);

    // Scrollback trimmed: baseY dropped to 100 (lines were evicted)
    mockTerminal.buffer.active.baseY = 100;
    mockTerminal.buffer.active.viewportY = 100; // xterm auto-scrolled during write
    mod.markWriteStart(ptyId);
    scrollHandler!();

    // Should cap at baseY (100), not try to scroll to 150
    expect(mockTerminal.scrollToLine).toHaveBeenCalledWith(100);

    mod.markWriteEnd(ptyId);
    mod.clearScrollAnchor(ptyId);
  });
});
