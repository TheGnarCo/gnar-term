/**
 * drag-reorder engine tests — the mouse-driven replacement for HTML5 DnD
 * (which is unreliable in Tauri's WKWebView). Verifies the activation
 * threshold, drop-index math (before/after edge), and Escape-to-cancel.
 *
 * jsdom returns zeroed getBoundingClientRect/elementFromPoint, so we stub
 * a 3-row vertical list and drive the cursor by Y coordinate.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDragReorder } from "../lib/actions/drag-reorder";

const ROW_H = 20;

function buildList(): HTMLElement {
  const container = document.createElement("div");
  container.className = "workspace-list";
  for (let i = 0; i < 3; i++) {
    const row = document.createElement("div");
    row.setAttribute("data-ws-drag-idx", String(i));
    Object.defineProperty(row, "offsetHeight", {
      value: ROW_H,
      configurable: true,
    });
    Object.defineProperty(row, "offsetWidth", {
      value: 100,
      configurable: true,
    });
    row.getBoundingClientRect = () =>
      ({
        top: i * ROW_H,
        bottom: (i + 1) * ROW_H,
        left: 0,
        right: 100,
        height: ROW_H,
        width: 100,
        x: 0,
        y: i * ROW_H,
        toJSON: () => ({}),
      }) as DOMRect;
    container.appendChild(row);
  }
  document.body.appendChild(container);
  return container;
}

function rowAtY(container: HTMLElement, y: number): HTMLElement | null {
  const rows = Array.from(
    container.querySelectorAll<HTMLElement>("[data-ws-drag-idx]"),
  );
  return (
    rows.find((r) => {
      const rect = r.getBoundingClientRect();
      return y >= rect.top && y < rect.bottom;
    }) ?? null
  );
}

describe("createDragReorder", () => {
  let container: HTMLElement;
  let onDrop: ReturnType<typeof vi.fn>;
  let handle: ReturnType<typeof createDragReorder>;

  beforeEach(() => {
    container = buildList();
    onDrop = vi.fn();
    handle = createDragReorder({
      dataAttr: "ws-drag-idx",
      containerSelector: ".workspace-list",
      ghostStyle: () => ({ background: "#000", border: "1px solid #fff" }),
      onDrop,
    });
    document.elementFromPoint = ((x: number, y: number) =>
      rowAtY(container, y)) as typeof document.elementFromPoint;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function startDrag(idx: number) {
    const row =
      container.querySelectorAll<HTMLElement>("[data-ws-drag-idx]")[idx];
    const e = new MouseEvent("mousedown", {
      button: 0,
      clientX: 50,
      clientY: idx * ROW_H + 10,
      bubbles: true,
    });
    Object.defineProperty(e, "target", { value: row });
    handle.start(e, idx);
  }

  function move(x: number, y: number) {
    window.dispatchEvent(
      new MouseEvent("mousemove", { clientX: x, clientY: y }),
    );
  }
  function up() {
    window.dispatchEvent(new MouseEvent("mouseup"));
  }

  it("does not start a drag below the 5px threshold", () => {
    startDrag(0);
    move(52, 12); // <5px total from (50,10)
    up();
    expect(handle.getState().active).toBe(false);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("drops row 0 after the last row → onDrop(0, 3)", () => {
    startDrag(0);
    move(60, 30); // activate (>5px)
    move(60, 55); // bottom half of row 2 → after
    up();
    expect(onDrop).toHaveBeenCalledWith(0, 3);
  });

  it("drops row 2 before row 0 → onDrop(2, 0)", () => {
    startDrag(2);
    move(60, 30); // activate
    move(60, 2); // top half of row 0 → before
    up();
    expect(onDrop).toHaveBeenCalledWith(2, 0);
  });

  it("does not fire onDrop when the drop resolves to the same slot", () => {
    startDrag(1);
    move(60, 35); // activate, within row 1
    move(60, 22); // top half of row 1 → before idx 1 → to=1 === from
    up();
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("Escape cancels the drag without firing onDrop", () => {
    startDrag(0);
    move(60, 30); // activate
    move(60, 55);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(handle.getState().active).toBe(false);
    up();
    expect(onDrop).not.toHaveBeenCalled();
  });
});
