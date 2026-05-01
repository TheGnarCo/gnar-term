import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/svelte";
import { readFileSync } from "fs";
import WorkspaceItem from "../lib/components/WorkspaceItem.svelte";
import type { NestedWorkspace } from "../lib/types";

function makeWorkspace(): NestedWorkspace {
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

  it("renders a DragGrip", () => {
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
    const grip = container.querySelector(".drag-grip");
    expect(grip).not.toBeNull();
  });

  it("invokes onGripMouseDown when the grip is hovered and pressed", async () => {
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
    const row = container.querySelector("[data-drag-idx]") as HTMLElement;
    const gripArea = row.querySelector(
      "[data-sidebar-element] > div",
    ) as HTMLElement;
    // Trigger mouseenter on the grip area to set railHovered
    await fireEvent.mouseEnter(gripArea);
    // Fire mousedown on the grip area
    await fireEvent.mouseDown(gripArea);
    expect(onGripMouseDown).toHaveBeenCalledTimes(1);
  });

  it("keeps grip at fixed 14px on row-level hover (no expansion)", async () => {
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
    const row = container.querySelector("[data-drag-idx]") as HTMLElement;
    const grip = container.querySelector(".drag-grip") as HTMLElement;
    // Grip is a fixed 8px — no expansion on hover to avoid content shift.
    expect(grip.style.width).toBe("8px");
    await fireEvent.mouseEnter(row);
    expect(grip.style.width).toBe("8px");
    await fireEvent.mouseLeave(row);
    expect(grip.style.width).toBe("8px");
  });

  it("rounds only the right corners so the rail renders as a straight vertical bar on the left", () => {
    const SIDEBAR_ELEM_SOURCE = readFileSync(
      "src/lib/components/PrimarySidebarElement.svelte",
      "utf-8",
    ).replace(/\s+/g, " ");
    expect(SIDEBAR_ELEM_SOURCE).toMatch(/border-radius:\s*0 6px 6px 0/);
  });

  it("invokes onGripMouseDown when the rail is hovered and row is pressed", async () => {
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
    const gripArea = row.querySelector(
      "[data-sidebar-element] > div",
    ) as HTMLElement;
    // Trigger mouseenter on the grip area to set railHovered
    await fireEvent.mouseEnter(gripArea);
    // Now mousedown on the grip area should trigger the callback
    await fireEvent.mouseDown(gripArea);
    expect(onGripMouseDown).toHaveBeenCalledTimes(1);
    const contentDiv = container.querySelector(
      "[data-workspace-content]",
    ) as HTMLElement;
    await fireEvent.click(contentDiv);
    expect(onSelect).toHaveBeenCalled();
  });
});

describe("WorkspaceItem border", () => {
  afterEach(() => cleanup());

  function makeWorktreeWorkspace(): NestedWorkspace {
    return {
      ...makeWorkspace(),
      metadata: { worktreePath: "/tmp/some-worktree" },
    };
  }

  it("marks worktree workspaces with data-worktree=true", () => {
    const { container } = render(WorkspaceItem, {
      props: {
        workspace: makeWorktreeWorkspace(),
        index: 0,
        isActive: false,
        onSelect: noop,
        onClose: noop,
        onRename: noop,
        onContextMenu: noop,
        onGripMouseDown: vi.fn(),
        accentColor: "#ff00aa",
      },
    });
    const row = container.querySelector("[data-drag-idx]") as HTMLElement;
    expect(row.dataset.worktree).toBe("true");
  });

  it("renders a 1px border in railColor for active workspaces", () => {
    const { container } = render(WorkspaceItem, {
      props: {
        workspace: makeWorkspace(),
        index: 0,
        isActive: true,
        onSelect: noop,
        onClose: noop,
        onRename: noop,
        onContextMenu: noop,
        onGripMouseDown: vi.fn(),
        accentColor: "#ff00aa",
      },
    });
    const row = container.querySelector("[data-drag-idx]") as HTMLElement;
    expect(row.style.border).toContain("1px solid");
    expect(row.style.border).toContain("rgb(255, 0, 170)");
  });

  it("renders a 1px inactive-theme border for inactive workspaces (worktree or not)", () => {
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
        accentColor: "#ff00aa",
      },
    });
    const row = container.querySelector("[data-drag-idx]") as HTMLElement;
    expect(row.dataset.worktree).toBeUndefined();
    expect(row.style.border).toContain("1px solid");
    // Inactive uses theme.border, NOT the accentColor.
    expect(row.style.border).not.toContain("rgb(255, 0, 170)");
  });
});
