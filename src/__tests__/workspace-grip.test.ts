import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/svelte";
import { readFileSync } from "fs";
import WorkspaceItem from "../lib/components/WorkspaceItem.svelte";
import type { Workspace } from "../lib/types";

const WORKSPACE_ITEM_SOURCE = readFileSync(
  "src/lib/components/WorkspaceItem.svelte",
  "utf-8",
).replace(/\s+/g, " ");

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

  it("rounds only the right corners so the rail renders as a straight vertical bar on the left", () => {
    expect(WORKSPACE_ITEM_SOURCE).toMatch(/border-radius:\s*0\s+6px\s+6px\s+0/);
    // Negative: the old uniform radius is gone.
    expect(WORKSPACE_ITEM_SOURCE).not.toMatch(/border-radius:\s*6px\s*;/);
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
    // Click on the inner content div (not the grip column, not the
    // absolute-positioned close button, not the fade overlay) still
    // selects. The content div is the last div child of the row.
    const contentDiv = container.querySelector(
      "[data-drag-idx] > div:last-of-type",
    ) as HTMLElement;
    await fireEvent.click(contentDiv);
    expect(onSelect).toHaveBeenCalled();
  });
});

describe("WorkspaceItem worktree border", () => {
  afterEach(() => cleanup());

  function makeWorktreeWorkspace(): Workspace {
    return {
      ...makeWorkspace(),
      metadata: { worktreePath: "/tmp/some-worktree" },
    };
  }

  it("renders a 1px border in railColor for worktree workspaces", () => {
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
    expect(row.style.border).toContain("1px solid");
    expect(row.style.border).toContain("rgb(255, 0, 170)");
  });

  it("falls back to theme.accent when no accentColor is passed", () => {
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
      },
    });
    const row = container.querySelector("[data-drag-idx]") as HTMLElement;
    expect(row.style.border).toContain("1px solid");
  });

  it("renders no border for non-worktree workspaces", () => {
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
    expect(row.style.border).toBe("");
  });
});
