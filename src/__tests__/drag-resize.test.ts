/**
 * drag-resize action tests — verify the drag lifecycle and, critically, that a
 * mid-drag unmount (destroy() while the user is still dragging) releases the
 * window-level listeners so onDrag never fires against a stale closure.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { dragResize } from "../lib/actions/drag-resize";

function mousedown() {
  return new MouseEvent("mousedown", { bubbles: true });
}
function mousemove(clientX = 50) {
  return new MouseEvent("mousemove", { clientX, bubbles: true });
}
function mouseup() {
  return new MouseEvent("mouseup", { bubbles: true });
}

describe("dragResize action", () => {
  let node: HTMLElement;

  beforeEach(() => {
    node = document.createElement("div");
    document.body.appendChild(node);
  });

  it("calls onDrag on mousemove during an active drag", () => {
    const onDrag = vi.fn();
    dragResize(node, { onDrag });

    node.dispatchEvent(mousedown());
    window.dispatchEvent(mousemove());
    expect(onDrag).toHaveBeenCalledTimes(1);
  });

  it("calls onEnd and stops onDrag after mouseup", () => {
    const onDrag = vi.fn();
    const onEnd = vi.fn();
    dragResize(node, { onDrag, onEnd });

    node.dispatchEvent(mousedown());
    window.dispatchEvent(mousemove());
    window.dispatchEvent(mouseup());
    expect(onEnd).toHaveBeenCalledTimes(1);

    window.dispatchEvent(mousemove());
    expect(onDrag).toHaveBeenCalledTimes(1); // no further calls after mouseup
  });

  it("respects onStart returning false (no drag begins)", () => {
    const onDrag = vi.fn();
    dragResize(node, { onDrag, onStart: () => false });

    node.dispatchEvent(mousedown());
    window.dispatchEvent(mousemove());
    expect(onDrag).not.toHaveBeenCalled();
  });

  it("releases listeners when destroyed mid-drag (no stale onDrag)", () => {
    const onDrag = vi.fn();
    const handle = dragResize(node, { onDrag });

    node.dispatchEvent(mousedown());
    window.dispatchEvent(mousemove());
    expect(onDrag).toHaveBeenCalledTimes(1);

    // Host element unmounts while the drag is still in flight.
    handle.destroy();

    window.dispatchEvent(mousemove());
    expect(onDrag).toHaveBeenCalledTimes(1); // listener was torn down
  });
});
