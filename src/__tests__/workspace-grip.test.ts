import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/svelte";
import WorkspaceItem from "../lib/components/WorkspaceItem.svelte";
import type { Workspace } from "../lib/types";

function makeWorkspace(): Workspace {
  return {
    id: "ws1",
    name: "Test",
    splitRoot: {
      type: "pane",
      pane: { id: "p1", surfaces: [], activeSurfaceId: null },
    },
    activePaneId: "p1",
  };
}

const noop = () => {};

describe("WorkspaceItem drag grip", () => {
  afterEach(() => cleanup());

  it("renders a DragGrip with drag aria-label", () => {
    const { container } = render(WorkspaceItem, {
      props: {
        workspace: makeWorkspace(),
        index: 0,
        isActive: false,
        onSelect: noop,
        onClose: noop,
        onRename: noop,
        onContextMenu: noop,
        onGripMouseDown: vi.fn(),
      },
    });
    const grip = container.querySelector(
      '[role="button"][aria-label*="rag" i]',
    );
    expect(grip).not.toBeNull();
  });

  it("invokes onGripMouseDown when the grip is pressed", async () => {
    const onGripMouseDown = vi.fn();
    const { container } = render(WorkspaceItem, {
      props: {
        workspace: makeWorkspace(),
        index: 0,
        isActive: false,
        onSelect: noop,
        onClose: noop,
        onRename: noop,
        onContextMenu: noop,
        onGripMouseDown,
      },
    });
    const grip = container.querySelector(
      '[role="button"][aria-label*="rag" i]',
    ) as HTMLElement;
    await fireEvent.mouseDown(grip);
    expect(onGripMouseDown).toHaveBeenCalledTimes(1);
  });

  it("does NOT invoke onGripMouseDown when row body is pressed", async () => {
    const onGripMouseDown = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(WorkspaceItem, {
      props: {
        workspace: makeWorkspace(),
        index: 0,
        isActive: false,
        onSelect,
        onClose: noop,
        onRename: noop,
        onContextMenu: noop,
        onGripMouseDown,
      },
    });
    const row = container.querySelector("[data-drag-idx]") as HTMLElement;
    await fireEvent.mouseDown(row);
    // Mousedown on body bubbles, but the grip handler should not fire
    expect(onGripMouseDown).not.toHaveBeenCalled();
    // Click on the inner content div (not the grip) still selects
    const contentDiv = container.querySelector(
      "[data-drag-idx] > div:last-child",
    ) as HTMLElement;
    await fireEvent.click(contentDiv);
    expect(onSelect).toHaveBeenCalled();
  });
});
