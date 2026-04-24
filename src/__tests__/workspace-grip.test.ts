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

  it("expands the grip on row-level hover (not just grip-column hover)", async () => {
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
    const grip = container.querySelector(
      '[role="button"][aria-label*="rag" i]',
    ) as HTMLElement;
    // Baseline: the grip is in its collapsed 10px width until hover.
    expect(grip.style.width).toBe("10px");
    // Hover the row body (not the grip itself) — the grip should expand.
    await fireEvent.mouseEnter(row);
    expect(grip.style.width).toBe("20px");
    await fireEvent.mouseLeave(row);
    expect(grip.style.width).toBe("10px");
  });

  it("rounds only the right corners so the rail renders as a straight vertical bar on the left", () => {
    expect(WORKSPACE_ITEM_SOURCE).toMatch(/border-radius:\s*0\s+6px\s+6px\s+0/);
    // Negative: the old uniform radius is gone.
    expect(WORKSPACE_ITEM_SOURCE).not.toMatch(/border-radius:\s*6px\s*;/);
  });

  it("invokes onGripMouseDown when ANY part of the row body is pressed (row-level drag-origin)", async () => {
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
    // Row-level mousedown is the drag-start surface now; a tap (mousedown
    // below createDragReorder's 5px threshold) still lets click fire on
    // the inner content div so selection works for single clicks.
    expect(onGripMouseDown).toHaveBeenCalledTimes(1);
    const contentDiv = container.querySelector(
      "[data-drag-idx] > div:last-of-type",
    ) as HTMLElement;
    await fireEvent.click(contentDiv);
    expect(onSelect).toHaveBeenCalled();
  });
});

describe("WorkspaceItem border", () => {
  afterEach(() => cleanup());

  function makeWorktreeWorkspace(): Workspace {
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
