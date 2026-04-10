/**
 * Linux scroll/redraw loop regression tests (#46)
 *
 * On Linux (WebKitGTK), PTY output can trigger spurious ResizeObserver
 * callbacks, creating a fit() → resize_pty → SIGWINCH → redraw loop that
 * yanks the viewport to the top. These tests verify the two guards:
 *
 * 1. resize_pty dedup — onResize skips invoke when cols/rows haven't changed
 * 2. Scroll anchor — user scroll position is preserved when new data arrives
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
  let resizeHandler: (size: { cols: number; rows: number }) => void;
  let mockInvoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockInvoke = invoke as ReturnType<typeof vi.fn>;
    mockInvoke.mockClear();

    // We replicate the onResize wiring from terminal-service.ts
    // to test the dedup guard in isolation.
  });

  it("calls resize_pty on first resize", async () => {
    // Import the module to get the dedup helper
    const { createResizeHandler } = await import("../lib/resize-guard");

    const handler = createResizeHandler(() => 1); // ptyId = 1
    handler({ cols: 80, rows: 24 });

    expect(mockInvoke).toHaveBeenCalledWith("resize_pty", { ptyId: 1, cols: 80, rows: 24 });
  });

  it("skips resize_pty when cols/rows are unchanged", async () => {
    const { createResizeHandler } = await import("../lib/resize-guard");

    const handler = createResizeHandler(() => 1);
    handler({ cols: 80, rows: 24 });
    mockInvoke.mockClear();

    // Same dimensions — should be a no-op
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

    // First call — dimensions are new, should fit
    expect(shouldFit(800, 600, state)).toBe(true);
    expect(state.lastWidth).toBe(800);
    expect(state.lastHeight).toBe(600);

    // Same dimensions — should skip
    expect(shouldFit(800, 600, state)).toBe(false);

    // Changed dimensions — should fit
    expect(shouldFit(900, 600, state)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Scroll anchor — isScrolledToBottom detection
// ---------------------------------------------------------------------------

describe("Scroll anchor (#46)", () => {
  it("detects when terminal is at the bottom of scrollback", async () => {
    const { isScrolledToBottom } = await import("../lib/resize-guard");

    // Mock terminal with buffer info
    const mockTerminal = {
      buffer: {
        active: {
          baseY: 100,   // scrollback lines above viewport
          viewportY: 100, // current viewport offset
        },
      },
      rows: 24,
    };

    // Viewport is at the bottom (viewportY === baseY)
    expect(isScrolledToBottom(mockTerminal as any)).toBe(true);

    // User scrolled up
    mockTerminal.buffer.active.viewportY = 50;
    expect(isScrolledToBottom(mockTerminal as any)).toBe(false);
  });

  it("considers viewport at bottom when within 1 row tolerance", async () => {
    const { isScrolledToBottom } = await import("../lib/resize-guard");

    const mockTerminal = {
      buffer: {
        active: {
          baseY: 100,
          viewportY: 99, // 1 row off — should still count as "at bottom"
        },
      },
      rows: 24,
    };

    expect(isScrolledToBottom(mockTerminal as any)).toBe(true);
  });
});
