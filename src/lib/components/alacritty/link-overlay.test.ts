/**
 * link-overlay.test.ts — cycle-18, AC-3
 *
 * Tests for attachLinkOverlay: hover detection, modifier-click dispatch, and
 * lifecycle management. Test names contain "link" or "modifier_click" to
 * satisfy the verify-envelope gate.
 *
 * Note: These tests run in jsdom (vitest default). Since jsdom doesn't
 * support real canvas rendering, we mock canvas dimensions and use
 * simulated mouse events to drive the overlay logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { attachLinkOverlay } from "./link-overlay";
import type { GridSnapshot } from "../../types/terminal-ipc";

// ─── Tauri invoke mock ────────────────────────────────────────────────────────

// Mock @tauri-apps/api/core before the module under test imports it.
const mockInvoke = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => mockInvoke(cmd, args),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal GridSnapshot with one URL on row 0. */
function makeUrlGrid(url: string): GridSnapshot {
  const cols = 80;
  const prefix = "Visit ";
  const padded = (prefix + url).padEnd(cols, " ");
  const cells = [...padded].map((ch) => ({
    ch,
    fg: { kind: "Indexed" as const, value: 7 },
    bg: { kind: "Indexed" as const, value: 0 },
    attrs: 0,
  }));
  return {
    cols,
    rows: 1,
    cursor: {
      row: 0,
      col: 0,
      visible: false,
      shape: { kind: "hidden" as const },
    },
    rows_data: [{ cells }],
  };
}

/** Create a minimal HTMLCanvasElement usable in jsdom. */
function makeCanvas(
  cols = 80,
  rows = 1,
  cellW = 8,
  cellH = 16,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = cols * cellW;
  canvas.height = rows * cellH;
  return canvas;
}

/** Fire a synthetic mousemove event at the given canvas pixel offset. */
function fireMousemove(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  modifiers?: { metaKey?: boolean; ctrlKey?: boolean },
) {
  const rect = canvas.getBoundingClientRect();
  canvas.dispatchEvent(
    new MouseEvent("mousemove", {
      bubbles: true,
      clientX: rect.left + x,
      clientY: rect.top + y,
      metaKey: modifiers?.metaKey ?? false,
      ctrlKey: modifiers?.ctrlKey ?? false,
    }),
  );
}

/** Fire a synthetic click event at the given canvas pixel offset. */
function fireClick(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  modifiers?: { metaKey?: boolean; ctrlKey?: boolean },
) {
  const rect = canvas.getBoundingClientRect();
  canvas.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      clientX: rect.left + x,
      clientY: rect.top + y,
      metaKey: modifiers?.metaKey ?? false,
      ctrlKey: modifiers?.ctrlKey ?? false,
    }),
  );
}

// ─── attachLinkOverlay tests ──────────────────────────────────────────────────

describe("attachLinkOverlay — lifecycle", () => {
  it("link_overlay_attaches_and_returns_handle_with_detach", () => {
    const canvas = makeCanvas();
    const handle = attachLinkOverlay(canvas, {
      cellWidth: 8,
      cellHeight: 16,
      getGrid: () => makeUrlGrid("https://example.com"),
    });
    expect(handle).toBeDefined();
    expect(typeof handle.detach).toBe("function");
    handle.detach();
  });

  it("link_overlay_detach_removes_event_listeners", () => {
    const canvas = makeCanvas();
    const removeListenerSpy = vi.spyOn(canvas, "removeEventListener");

    const handle = attachLinkOverlay(canvas, {
      cellWidth: 8,
      cellHeight: 16,
      getGrid: () => makeUrlGrid("https://example.com"),
    });

    handle.detach();
    // At minimum mousemove and click listeners should be removed.
    expect(removeListenerSpy).toHaveBeenCalled();
  });
});

describe("attachLinkOverlay — hover detection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockInvoke.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("link_hover_calls_decorate_callback_when_over_url", () => {
    const canvas = makeCanvas(80, 1, 8, 16);
    const decorateSpy = vi.fn();
    const url = "https://hover-test.com";
    const prefix = "Visit ";
    const grid = makeUrlGrid(url);

    const handle = attachLinkOverlay(canvas, {
      cellWidth: 8,
      cellHeight: 16,
      getGrid: () => grid,
      onDecorate: decorateSpy,
    });

    // Move mouse over the URL region (prefix is 6 chars = 48px offset)
    const urlStartX = prefix.length * 8 + 4; // center of first URL char
    const urlCenterY = 8; // center of row 0
    fireMousemove(canvas, urlStartX, urlCenterY);

    // Flush debounce timer
    vi.runAllTimers();

    // decorate should be called with a match for the url
    expect(decorateSpy).toHaveBeenCalled();
    const [match] = decorateSpy.mock.calls[0] as [{ text: string } | null];
    expect(match?.text).toContain(url);

    handle.detach();
  });

  it("link_hover_calls_decorate_with_null_when_not_over_link", () => {
    const canvas = makeCanvas(80, 1, 8, 16);
    const decorateSpy = vi.fn();
    const grid = makeUrlGrid("https://example.com");

    const handle = attachLinkOverlay(canvas, {
      cellWidth: 8,
      cellHeight: 16,
      getGrid: () => grid,
      onDecorate: decorateSpy,
    });

    // Move to a region with no URL: x=0 (the "V" in "Visit")
    fireMousemove(canvas, 0, 8);
    vi.runAllTimers();

    expect(decorateSpy).toHaveBeenCalledWith(null);
    handle.detach();
  });
});

describe("attachLinkOverlay — modifier_click dispatch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockInvoke.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("modifier_click_invokes_open_url_command_on_meta_click", () => {
    const canvas = makeCanvas(80, 1, 8, 16);
    const url = "https://modifier-click-test.org";
    const prefix = "Visit ";
    const grid = makeUrlGrid(url);

    const handle = attachLinkOverlay(canvas, {
      cellWidth: 8,
      cellHeight: 16,
      getGrid: () => grid,
    });

    const urlStartX = prefix.length * 8 + 4;
    // Click with metaKey (Cmd on macOS)
    fireClick(canvas, urlStartX, 8, { metaKey: true });
    vi.runAllTimers();

    // Should call open_url with the URL
    expect(mockInvoke).toHaveBeenCalledWith("open_url", { url });

    handle.detach();
  });

  it("modifier_click_invokes_open_url_command_on_ctrl_click", () => {
    const canvas = makeCanvas(80, 1, 8, 16);
    const url = "https://ctrl-click-test.net";
    const prefix = "Visit ";
    const grid = makeUrlGrid(url);

    const handle = attachLinkOverlay(canvas, {
      cellWidth: 8,
      cellHeight: 16,
      getGrid: () => grid,
    });

    const urlStartX = prefix.length * 8 + 4;
    // Click with ctrlKey (Ctrl on Linux)
    fireClick(canvas, urlStartX, 8, { ctrlKey: true });
    vi.runAllTimers();

    expect(mockInvoke).toHaveBeenCalledWith("open_url", { url });

    handle.detach();
  });

  it("modifier_click_does_not_invoke_without_modifier", () => {
    const canvas = makeCanvas(80, 1, 8, 16);
    const grid = makeUrlGrid("https://no-modifier.com");
    const prefix = "Visit ";

    const handle = attachLinkOverlay(canvas, {
      cellWidth: 8,
      cellHeight: 16,
      getGrid: () => grid,
    });

    const urlStartX = prefix.length * 8 + 4;
    // Plain click — no modifier
    fireClick(canvas, urlStartX, 8);
    vi.runAllTimers();

    expect(mockInvoke).not.toHaveBeenCalled();

    handle.detach();
  });

  it("modifier_click_invokes_open_url_for_file_scheme_url", () => {
    const canvas = makeCanvas(80, 1, 8, 16);
    // Use a file:// URL grid
    const fileUrl = "file:///home/user/project/src/main.ts";
    const prefix = "Visit ";
    const padded = (prefix + fileUrl).padEnd(80, " ");
    const cells = [...padded].map((ch) => ({
      ch,
      fg: { kind: "Indexed" as const, value: 7 },
      bg: { kind: "Indexed" as const, value: 0 },
      attrs: 0,
    }));
    const grid: GridSnapshot = {
      cols: 80,
      rows: 1,
      cursor: {
        row: 0,
        col: 0,
        visible: false,
        shape: { kind: "hidden" as const },
      },
      rows_data: [{ cells }],
    };

    const handle = attachLinkOverlay(canvas, {
      cellWidth: 8,
      cellHeight: 16,
      getGrid: () => grid,
    });

    const urlStartX = prefix.length * 8 + 4;
    fireClick(canvas, urlStartX, 8, { metaKey: true });
    vi.runAllTimers();

    expect(mockInvoke).toHaveBeenCalledWith("open_url", { url: fileUrl });
    handle.detach();
  });
});
