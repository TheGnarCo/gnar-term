/**
 * Linux scroll/redraw loop regression tests (#46)
 *
 * On Linux (WebKitGTK), PTY output can trigger spurious ResizeObserver
 * callbacks, creating a fit() → resize_pty → SIGWINCH → redraw loop.
 * The resize cycle also breaks xterm.js's native scroll lock
 * (isUserScrolling) via the Viewport._sync() → scrollLines() path.
 *
 * These tests verify the two resize guards that break the loop:
 * 1. createResizeHandler — deduplicates resize_pty calls
 * 2. shouldFit — skips fit() when container pixel dimensions are unchanged
 *
 * Scroll anchoring is handled natively by xterm.js (BufferService.isUserScrolling).
 * The resize guards protect that flag by preventing spurious resize cycles.
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
// 3. Regression guard — no scroll anchor exports
// ---------------------------------------------------------------------------

describe("resize-guard exports (#46)", () => {
  it("does not export scroll anchor functions (xterm.js handles scroll lock natively)", async () => {
    const mod = await import("../lib/resize-guard");
    const exports = Object.keys(mod);
    expect(exports).toContain("createResizeHandler");
    expect(exports).toContain("shouldFit");
    // These should NOT be exported — scroll anchoring is handled by xterm.js's
    // built-in isUserScrolling flag. Our resize guards protect that flag.
    expect(exports).not.toContain("setupScrollAnchor");
    expect(exports).not.toContain("markWriteStart");
    expect(exports).not.toContain("markWriteEnd");
    expect(exports).not.toContain("getScrollAnchor");
    expect(exports).not.toContain("clearScrollAnchor");
  });
});
