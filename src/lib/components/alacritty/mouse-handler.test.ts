/**
 * mouse-handler.test.ts — AC-2 mouse-driven selection tests.
 *
 * Tests verify:
 * - Single click starts a cell (Simple) selection → `start_selection`
 * - Mouse drag extends the selection → `update_selection`
 * - mouse_drag_selection: drag emits the right invoke sequence
 * - Double click uses Semantic mode
 * - Triple click uses Lines mode
 * - Shift-click extends via `update_selection` (not `start_selection`)
 * - Clicking outside the canvas clears the selection
 * - `detach()` removes all listeners
 * - `pixelToCell` rounding is correct
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { attachMouse } from "./mouse-handler";
import type { MouseOptions, InvokeFn } from "./mouse-handler";

// ─── DOM environment helpers ──────────────────────────────────────────────────

/** Minimal canvas double that records getBoundingClientRect() */
function makeCanvas(x = 0, y = 0, w = 800, h = 480) {
  const el = document.createElement("canvas");
  el.getBoundingClientRect = () => ({
    left: x,
    top: y,
    width: w,
    height: h,
    right: x + w,
    bottom: y + h,
    toJSON: () => ({}),
    x,
    y,
  });
  return el;
}

/** Fire a synthetic MouseEvent on an element. */
function fireMouseEvent(
  target: EventTarget,
  type: string,
  opts: Partial<MouseEventInit> = {},
) {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...opts,
  });
  target.dispatchEvent(ev);
}

// ─── Default opts ──────────────────────────────────────────────────────────────

const CELL_W = 8;
const CELL_H = 16;
const PANE_ID = "pane-test";

function makeOpts(invoke: InvokeFn): MouseOptions {
  return {
    cell_width: CELL_W,
    cell_height: CELL_H,
    paneId: PANE_ID,
    invoke,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("attachMouse (mouse-handler)", () => {
  let canvas: HTMLCanvasElement;
  let calls: Array<[string, Record<string, unknown> | undefined]>;
  let invoke: InvokeFn;

  beforeEach(() => {
    canvas = makeCanvas(0, 0);
    document.body.appendChild(canvas);
    calls = [];
    invoke = async (cmd, args) => {
      calls.push([cmd, args]);
    };
  });

  afterEach(() => {
    canvas.remove();
    calls = [];
  });

  // ── single click starts a Simple selection ─────────────────────────────────

  it("single click starts a Simple cell-mode selection", () => {
    const handle = attachMouse(canvas, makeOpts(invoke));

    // Click at pixel (8, 16) → cell (col=1, row=1)
    fireMouseEvent(canvas, "mousedown", { clientX: 8, clientY: 16 });
    fireMouseEvent(canvas, "mouseup", { clientX: 8, clientY: 16 });

    expect(calls[0]).toEqual([
      "start_selection",
      { paneId: PANE_ID, row: 1, col: 1, mode: "simple" },
    ]);

    handle.detach();
  });

  // ── mouse_drag_selection: drag emits start then update ────────────────────

  it("mouse_drag_selection: mousedown then mousemove emits start + update", () => {
    const handle = attachMouse(canvas, makeOpts(invoke));

    // Start drag at (0, 0) → cell (col=0, row=0)
    fireMouseEvent(canvas, "mousedown", { clientX: 0, clientY: 0 });
    // Drag to (16, 32) → cell (col=2, row=2)
    fireMouseEvent(canvas, "mousemove", { clientX: 16, clientY: 32 });
    fireMouseEvent(canvas, "mouseup", { clientX: 16, clientY: 32 });

    const first = calls[0]!;
    const second = calls[1]!;
    expect(first[0]).toBe("start_selection");
    expect(first[1]).toMatchObject({ mode: "simple", row: 0, col: 0 });

    expect(second[0]).toBe("update_selection");
    expect(second[1]).toMatchObject({ row: 2, col: 2 });

    handle.detach();
  });

  // ── mousemove without mousedown does not emit ─────────────────────────────

  it("mousemove without prior mousedown does not emit update_selection", () => {
    const handle = attachMouse(canvas, makeOpts(invoke));

    fireMouseEvent(canvas, "mousemove", { clientX: 40, clientY: 80 });

    expect(calls).toHaveLength(0);

    handle.detach();
  });

  // ── double click uses Semantic mode ──────────────────────────────────────

  it("rapid double-click starts a Semantic (word) selection", () => {
    const handle = attachMouse(canvas, makeOpts(invoke));

    // Two clicks in quick succession
    fireMouseEvent(canvas, "mousedown", { clientX: 0, clientY: 0 });
    fireMouseEvent(canvas, "mouseup", { clientX: 0, clientY: 0 });
    fireMouseEvent(canvas, "mousedown", { clientX: 0, clientY: 0 });
    fireMouseEvent(canvas, "mouseup", { clientX: 0, clientY: 0 });

    // The second mousedown should have started a Semantic selection
    const semanticCall = calls.find(
      ([cmd, args]) =>
        cmd === "start_selection" &&
        (args as Record<string, unknown>)?.mode === "semantic",
    );
    expect(semanticCall).toBeTruthy();

    handle.detach();
  });

  // ── triple click uses Lines mode ──────────────────────────────────────────

  it("rapid triple-click starts a Lines selection", () => {
    const handle = attachMouse(canvas, makeOpts(invoke));

    // Three clicks in quick succession
    fireMouseEvent(canvas, "mousedown", { clientX: 0, clientY: 0 });
    fireMouseEvent(canvas, "mouseup", { clientX: 0, clientY: 0 });
    fireMouseEvent(canvas, "mousedown", { clientX: 0, clientY: 0 });
    fireMouseEvent(canvas, "mouseup", { clientX: 0, clientY: 0 });
    fireMouseEvent(canvas, "mousedown", { clientX: 0, clientY: 0 });
    fireMouseEvent(canvas, "mouseup", { clientX: 0, clientY: 0 });

    const linesCall = calls.find(
      ([cmd, args]) =>
        cmd === "start_selection" &&
        (args as Record<string, unknown>)?.mode === "lines",
    );
    expect(linesCall).toBeTruthy();

    handle.detach();
  });

  // ── shift-click extends via update_selection ──────────────────────────────

  it("shift+click emits update_selection to extend the selection", () => {
    const handle = attachMouse(canvas, makeOpts(invoke));

    // First: normal click to start
    fireMouseEvent(canvas, "mousedown", { clientX: 0, clientY: 0 });
    fireMouseEvent(canvas, "mouseup", { clientX: 0, clientY: 0 });
    calls = [];

    // Shift-click at a different position
    fireMouseEvent(canvas, "mousedown", {
      clientX: 40,
      clientY: 80,
      shiftKey: true,
    });

    const shiftCall = calls[0]!;
    expect(shiftCall[0]).toBe("update_selection");
    expect(shiftCall[1]).toMatchObject({ paneId: PANE_ID });

    handle.detach();
  });

  // ── click outside canvas clears the selection ─────────────────────────────

  it("clicking outside the canvas emits clear_selection", () => {
    const handle = attachMouse(canvas, makeOpts(invoke));

    // Start a selection
    fireMouseEvent(canvas, "mousedown", { clientX: 0, clientY: 0 });
    calls = [];

    // Click somewhere outside the canvas
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    fireMouseEvent(document, "mousedown", {
      target: outside,
    } as MouseEventInit);
    outside.remove();

    const clearCall = calls.find(([cmd]) => cmd === "clear_selection");
    expect(clearCall).toBeTruthy();

    handle.detach();
  });

  // ── right-click does nothing ──────────────────────────────────────────────

  it("right-click (button=2) does not start a selection", () => {
    const handle = attachMouse(canvas, makeOpts(invoke));

    fireMouseEvent(canvas, "mousedown", { clientX: 0, clientY: 0, button: 2 });

    expect(calls).toHaveLength(0);

    handle.detach();
  });

  // ── detach removes listeners ──────────────────────────────────────────────

  it("detach() prevents further invoke calls", () => {
    const handle = attachMouse(canvas, makeOpts(invoke));
    handle.detach();

    fireMouseEvent(canvas, "mousedown", { clientX: 0, clientY: 0 });
    fireMouseEvent(canvas, "mousemove", { clientX: 40, clientY: 80 });

    expect(calls).toHaveLength(0);
  });

  // ── pixel → cell mapping ──────────────────────────────────────────────────

  it("pixel coordinates map to expected cell indices", () => {
    const handle = attachMouse(canvas, makeOpts(invoke));

    // Click at exactly (CELL_W * 3, CELL_H * 5) → col=3, row=5
    fireMouseEvent(canvas, "mousedown", {
      clientX: CELL_W * 3,
      clientY: CELL_H * 5,
    });

    expect(calls[0]![1]).toMatchObject({ col: 3, row: 5 });

    handle.detach();
  });

  // ── selection-change custom event is dispatched ────────────────────────────

  it("mousedown dispatches a selection-change custom event on the canvas", () => {
    const handle = attachMouse(canvas, makeOpts(invoke));

    const events: CustomEvent[] = [];
    canvas.addEventListener("selection-change", (e) => {
      events.push(e as CustomEvent);
    });

    fireMouseEvent(canvas, "mousedown", { clientX: 0, clientY: 0 });

    expect(events).toHaveLength(1);
    expect(events[0]!.detail.phase).toBe("start");

    handle.detach();
  });
});
