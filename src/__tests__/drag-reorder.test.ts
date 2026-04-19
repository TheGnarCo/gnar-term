import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createDragReorder } from "../lib/actions/drag-reorder";

function makeContainer(count: number): HTMLElement {
  const container = document.createElement("div");
  container.id = "test-container";
  for (let i = 0; i < count; i++) {
    const item = document.createElement("div");
    item.setAttribute("data-drag-idx", String(i));
    item.style.height = "30px";
    container.appendChild(item);
  }
  document.body.appendChild(container);
  return container;
}

function resetDom() {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
}

function mouseEvent(
  type: string,
  opts: { clientX?: number; clientY?: number; button?: number } = {},
): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    button: opts.button ?? 0,
  });
}

describe("drag-reorder", () => {
  beforeEach(() => {
    resetDom();
  });

  afterEach(() => {
    resetDom();
    vi.restoreAllMocks();
  });

  it("calls onDrop on a valid drop", () => {
    makeContainer(2);
    const onDrop = vi.fn();
    const handle = createDragReorder({
      dataAttr: "drag-idx",
      containerSelector: "#test-container",
      ghostStyle: () => ({ background: "black", border: "1px solid red" }),
      onDrop,
    });

    const items = document.querySelectorAll("[data-drag-idx]");
    const first = items[0] as HTMLElement;
    document.elementFromPoint = vi.fn(() => items[1] as HTMLElement);
    (items[1] as HTMLElement).getBoundingClientRect = () =>
      ({
        top: 30,
        height: 30,
        bottom: 60,
        left: 0,
        right: 100,
        width: 100,
      }) as DOMRect;

    const down = mouseEvent("mousedown", { clientX: 0, clientY: 0 });
    Object.defineProperty(down, "target", { value: first });
    handle.start(down, 0);

    window.dispatchEvent(mouseEvent("mousemove", { clientX: 0, clientY: 10 }));
    window.dispatchEvent(mouseEvent("mousemove", { clientX: 0, clientY: 50 }));

    window.dispatchEvent(mouseEvent("mouseup"));

    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it("fires onStateChange when Escape cancels the drag (so Svelte state can sync)", () => {
    makeContainer(2);
    const onStateChange = vi.fn();
    const handle = createDragReorder({
      dataAttr: "drag-idx",
      containerSelector: "#test-container",
      ghostStyle: () => ({ background: "black", border: "1px solid red" }),
      onDrop: vi.fn(),
      onStateChange,
    });

    const items = document.querySelectorAll("[data-drag-idx]");
    const first = items[0] as HTMLElement;
    document.elementFromPoint = vi.fn(() => items[1] as HTMLElement);
    (items[1] as HTMLElement).getBoundingClientRect = () =>
      ({
        top: 30,
        height: 30,
        bottom: 60,
        left: 0,
        right: 100,
        width: 100,
      }) as DOMRect;

    const down = mouseEvent("mousedown", { clientX: 0, clientY: 0 });
    Object.defineProperty(down, "target", { value: first });
    handle.start(down, 0);

    window.dispatchEvent(mouseEvent("mousemove", { clientX: 0, clientY: 10 }));
    onStateChange.mockClear();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(onStateChange).toHaveBeenCalled();
    expect(handle.getState().active).toBe(false);
  });

  it("cancels the drop when Escape is pressed mid-drag", () => {
    makeContainer(2);
    const onDrop = vi.fn();
    const handle = createDragReorder({
      dataAttr: "drag-idx",
      containerSelector: "#test-container",
      ghostStyle: () => ({ background: "black", border: "1px solid red" }),
      onDrop,
    });

    const items = document.querySelectorAll("[data-drag-idx]");
    const first = items[0] as HTMLElement;
    document.elementFromPoint = vi.fn(() => items[1] as HTMLElement);
    (items[1] as HTMLElement).getBoundingClientRect = () =>
      ({
        top: 30,
        height: 30,
        bottom: 60,
        left: 0,
        right: 100,
        width: 100,
      }) as DOMRect;

    const down = mouseEvent("mousedown", { clientX: 0, clientY: 0 });
    Object.defineProperty(down, "target", { value: first });
    handle.start(down, 0);

    window.dispatchEvent(mouseEvent("mousemove", { clientX: 0, clientY: 10 }));
    window.dispatchEvent(mouseEvent("mousemove", { clientX: 0, clientY: 50 }));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    window.dispatchEvent(mouseEvent("mouseup"));

    expect(onDrop).not.toHaveBeenCalled();
    expect(handle.getState().active).toBe(false);
    expect(handle.getState().indicator).toBeNull();
    expect(handle.getState().sourceIdx).toBeNull();
    expect(document.body.querySelectorAll("[data-drag-idx]").length).toBe(2);
  });
});
