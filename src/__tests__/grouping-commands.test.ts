/**
 * Tests for the command-palette / keyboard grouping entry points
 * (grouping-commands service):
 *   - Switch-to / ⌘1-9 resolve against `workspaceOrder` (display order), not
 *     the raw `$workspaces` array index (RISK 1).
 *   - Group / Add-to-Group / Ungroup operate on the active workspace.
 *   - Collapse/Expand toggles the active group via `groupCollapsedState`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

let _surfaceSeq = 0;
vi.mock("../lib/terminal-service", () => ({
  createTerminalSurface: vi.fn(async (pane: any, cwd?: string) => {
    const surface = {
      kind: "terminal",
      id: `surf-${++_surfaceSeq}`,
      title: "Shell",
      cwd,
      hasUnread: false,
      terminal: { focus: () => {}, dispose: () => {} },
      ptyId: -1,
    };
    pane.surfaces.push(surface);
    pane.activeSurfaceId = surface.id;
    return surface;
  }),
}));

import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import {
  workspaceOrder,
  setWorkspaceOrder,
  cancelOrderPersist,
} from "../lib/stores/workspace-order";
import { groupCollapsedState } from "../lib/stores/ui";
import { cancelPersist } from "../lib/services/workspace-persist";
import {
  orderedAnchorIds,
  orderedAnchorWorkspaces,
  switchToOrderedWorkspace,
  switchToLastOrderedWorkspace,
  groupIdOf,
  groupActiveWorkspace,
  addActiveToGroup,
  ungroupActiveWorkspace,
  toggleActiveGroupCollapsed,
  anchorsWithMembers,
} from "../lib/services/grouping-commands";
import { addMemberToGroup, closeWorkspace } from "../lib/services/workspace-service";
import type { Workspace, Pane } from "../lib/types";

function ws(id: string, extra: Partial<Workspace> = {}): Workspace {
  const pane: Pane = { id: `${id}-p`, surfaces: [], activeSurfaceId: null };
  return {
    id,
    name: id,
    splitRoot: { type: "pane", pane },
    activePaneId: pane.id,
    ...extra,
  };
}

const orderIds = () => get(workspaceOrder).map((r) => r.id);

beforeEach(() => {
  cancelPersist();
  cancelOrderPersist();
  workspaces.set([]);
  setWorkspaceOrder([]);
  groupCollapsedState.set(new Map());
  activeWorkspaceIdx.set(-1);
  cancelOrderPersist();
});

describe("orderedAnchorIds / orderedAnchorWorkspaces", () => {
  it("returns row ids in display order, excluding members", () => {
    workspaces.set([
      ws("b"),
      ws("a"),
      ws("m1", { anchorWorkspaceId: "a" }),
    ]);
    // Display order is b, a (members never own a row).
    setWorkspaceOrder([
      { kind: "workspace", id: "b" },
      { kind: "workspace", id: "a" },
    ]);
    cancelOrderPersist();
    expect(orderedAnchorIds()).toEqual(["b", "a"]);
    expect(orderedAnchorWorkspaces().map((w) => w.id)).toEqual(["b", "a"]);
  });

  it("falls back to the anchor store when no order is set", () => {
    workspaces.set([ws("x"), ws("y"), ws("m", { anchorWorkspaceId: "x" })]);
    setWorkspaceOrder([]);
    cancelOrderPersist();
    expect(orderedAnchorIds().sort()).toEqual(["x", "y"]);
  });

  it("drops order rows whose referent is missing from the store", () => {
    workspaces.set([ws("a")]);
    setWorkspaceOrder([
      { kind: "workspace", id: "ghost" },
      { kind: "workspace", id: "a" },
    ]);
    cancelOrderPersist();
    expect(orderedAnchorWorkspaces().map((w) => w.id)).toEqual(["a"]);
  });
});

describe("switchToOrderedWorkspace (⌘1-9 reconciliation)", () => {
  it("maps a display-order position to the right array index", () => {
    // Array order [a,b,c] but DISPLAY order [c,a,b].
    workspaces.set([ws("a"), ws("b"), ws("c")]);
    setWorkspaceOrder([
      { kind: "workspace", id: "c" },
      { kind: "workspace", id: "a" },
      { kind: "workspace", id: "b" },
    ]);
    cancelOrderPersist();

    switchToOrderedWorkspace(0); // first DISPLAY row = c = array idx 2
    expect(get(activeWorkspaceIdx)).toBe(2);

    switchToOrderedWorkspace(1); // a = array idx 0
    expect(get(activeWorkspaceIdx)).toBe(0);
  });

  it("ignores out-of-range positions", () => {
    workspaces.set([ws("a")]);
    setWorkspaceOrder([{ kind: "workspace", id: "a" }]);
    cancelOrderPersist();
    activeWorkspaceIdx.set(0);
    switchToOrderedWorkspace(5);
    switchToOrderedWorkspace(-1);
    expect(get(activeWorkspaceIdx)).toBe(0);
  });

  it("switchToLastOrderedWorkspace selects the last display row", () => {
    workspaces.set([ws("a"), ws("b"), ws("c")]);
    setWorkspaceOrder([
      { kind: "workspace", id: "c" },
      { kind: "workspace", id: "b" },
      { kind: "workspace", id: "a" },
    ]);
    cancelOrderPersist();
    switchToLastOrderedWorkspace(); // last DISPLAY row = a = array idx 0
    expect(get(activeWorkspaceIdx)).toBe(0);
  });

  it("skips members so ⌘N targets only visible rows", () => {
    // a is an anchor with member m; only a and b are visible rows.
    workspaces.set([
      ws("a", { memberWorkspaceIds: ["m"] }),
      ws("m", { anchorWorkspaceId: "a" }),
      ws("b"),
    ]);
    setWorkspaceOrder([
      { kind: "workspace", id: "a" },
      { kind: "workspace", id: "b" },
    ]);
    cancelOrderPersist();
    switchToOrderedWorkspace(1); // second visible row = b = array idx 2
    expect(get(activeWorkspaceIdx)).toBe(2);
  });
});

describe("groupIdOf", () => {
  it("resolves a member to its anchor, an anchor-with-members to itself", () => {
    const anchor = ws("a", { memberWorkspaceIds: ["m"] });
    const member = ws("m", { anchorWorkspaceId: "a" });
    const lone = ws("lone");
    expect(groupIdOf(member)).toBe("a");
    expect(groupIdOf(anchor)).toBe("a");
    expect(groupIdOf(lone)).toBeNull();
  });
});

describe("groupActiveWorkspace", () => {
  it("absorbs the next standalone sibling as the first member", () => {
    workspaces.set([ws("a"), ws("b"), ws("c")]);
    setWorkspaceOrder([
      { kind: "workspace", id: "a" },
      { kind: "workspace", id: "b" },
      { kind: "workspace", id: "c" },
    ]);
    cancelOrderPersist();
    activeWorkspaceIdx.set(0); // active = a

    const absorbed = groupActiveWorkspace();
    expect(absorbed).toBe("b");
    const list = get(workspaces);
    expect(list.find((w) => w.id === "a")?.memberWorkspaceIds).toEqual(["b"]);
    expect(list.find((w) => w.id === "b")?.anchorWorkspaceId).toBe("a");
    // b lost its top-level row; a and c remain.
    expect(orderIds()).toEqual(["a", "c"]);
  });

  it("no-ops when the active workspace is a member or has no sibling", () => {
    workspaces.set([ws("a", { memberWorkspaceIds: ["m"] }), ws("m", { anchorWorkspaceId: "a" })]);
    setWorkspaceOrder([{ kind: "workspace", id: "a" }]);
    cancelOrderPersist();
    // Active = the member m (array idx 1).
    activeWorkspaceIdx.set(1);
    expect(groupActiveWorkspace()).toBeNull();
  });
});

describe("addActiveToGroup", () => {
  it("adds the active standalone workspace to the target group", () => {
    workspaces.set([ws("anchor", { memberWorkspaceIds: ["m1"] }), ws("m1", { anchorWorkspaceId: "anchor" }), ws("lone")]);
    setWorkspaceOrder([
      { kind: "workspace", id: "anchor" },
      { kind: "workspace", id: "lone" },
    ]);
    cancelOrderPersist();
    activeWorkspaceIdx.set(2); // active = lone

    expect(addActiveToGroup("anchor")).toBe(true);
    const list = get(workspaces);
    expect(list.find((w) => w.id === "lone")?.anchorWorkspaceId).toBe("anchor");
    expect(list.find((w) => w.id === "anchor")?.memberWorkspaceIds).toEqual(["m1", "lone"]);
    expect(orderIds()).toEqual(["anchor"]);
  });

  it("refuses to add a workspace to itself or when already grouped", () => {
    workspaces.set([ws("anchor"), ws("m", { anchorWorkspaceId: "anchor" })]);
    setWorkspaceOrder([{ kind: "workspace", id: "anchor" }]);
    cancelOrderPersist();
    activeWorkspaceIdx.set(0); // active = anchor
    expect(addActiveToGroup("anchor")).toBe(false);
    activeWorkspaceIdx.set(1); // active = m (already a member)
    expect(addActiveToGroup("anchor")).toBe(false);
  });
});

describe("ungroupActiveWorkspace", () => {
  it("detaches an active member and restores its row after the anchor", () => {
    workspaces.set([
      ws("anchor", { memberWorkspaceIds: ["m1", "m2"] }),
      ws("m1", { anchorWorkspaceId: "anchor" }),
      ws("m2", { anchorWorkspaceId: "anchor" }),
    ]);
    setWorkspaceOrder([{ kind: "workspace", id: "anchor" }]);
    cancelOrderPersist();
    activeWorkspaceIdx.set(1); // active = m1

    expect(ungroupActiveWorkspace()).toBe(true);
    const list = get(workspaces);
    expect(list.find((w) => w.id === "m1")?.anchorWorkspaceId).toBeUndefined();
    expect(list.find((w) => w.id === "anchor")?.memberWorkspaceIds).toEqual(["m2"]);
    // m1 gets a fresh row right after its former anchor.
    expect(orderIds()).toEqual(["anchor", "m1"]);
  });

  it("dissolves a whole group when the active workspace is the anchor", () => {
    workspaces.set([
      ws("anchor", { memberWorkspaceIds: ["m1", "m2"] }),
      ws("m1", { anchorWorkspaceId: "anchor" }),
      ws("m2", { anchorWorkspaceId: "anchor" }),
    ]);
    setWorkspaceOrder([{ kind: "workspace", id: "anchor" }]);
    cancelOrderPersist();
    activeWorkspaceIdx.set(0); // active = anchor

    expect(ungroupActiveWorkspace()).toBe(true);
    const list = get(workspaces);
    expect(list.find((w) => w.id === "m1")?.anchorWorkspaceId).toBeUndefined();
    expect(list.find((w) => w.id === "m2")?.anchorWorkspaceId).toBeUndefined();
    expect(list.find((w) => w.id === "anchor")?.memberWorkspaceIds).toEqual([]);
    // Every former member now owns a top-level row.
    expect(orderIds().sort()).toEqual(["anchor", "m1", "m2"]);
  });

  it("no-ops on a standalone workspace", () => {
    workspaces.set([ws("lone")]);
    setWorkspaceOrder([{ kind: "workspace", id: "lone" }]);
    cancelOrderPersist();
    activeWorkspaceIdx.set(0);
    expect(ungroupActiveWorkspace()).toBe(false);
  });
});

describe("toggleActiveGroupCollapsed", () => {
  it("toggles the active group's collapsed flag (default collapsed → expand)", () => {
    workspaces.set([ws("anchor", { memberWorkspaceIds: ["m"] }), ws("m", { anchorWorkspaceId: "anchor" })]);
    setWorkspaceOrder([{ kind: "workspace", id: "anchor" }]);
    cancelOrderPersist();
    activeWorkspaceIdx.set(0); // active = anchor

    // Missing entry defaults to collapsed; first toggle expands.
    toggleActiveGroupCollapsed();
    expect(get(groupCollapsedState).get("anchor")).toBe(false);
    toggleActiveGroupCollapsed();
    expect(get(groupCollapsedState).get("anchor")).toBe(true);
  });

  it("no-ops when the active workspace has no group", () => {
    workspaces.set([ws("lone")]);
    setWorkspaceOrder([{ kind: "workspace", id: "lone" }]);
    cancelOrderPersist();
    activeWorkspaceIdx.set(0);
    toggleActiveGroupCollapsed();
    expect(get(groupCollapsedState).size).toBe(0);
  });
});

describe("anchorsWithMembers", () => {
  it("lists only anchors that own at least one member", () => {
    workspaces.set([
      ws("a", { memberWorkspaceIds: ["m"] }),
      ws("m", { anchorWorkspaceId: "a" }),
      ws("lone", { memberWorkspaceIds: [] }),
      ws("lone2"),
    ]);
    expect(anchorsWithMembers().map((w) => w.id)).toEqual(["a"]);
  });
});

describe("closeWorkspace is group-aware (⇧⌘W / palette Close Workspace)", () => {
  it("promotes the first member when closing an anchor that owns members", () => {
    workspaces.set([
      ws("before"),
      ws("anchor", { memberWorkspaceIds: ["m1", "m2"] }),
      ws("m1", { anchorWorkspaceId: "anchor" }),
      ws("m2", { anchorWorkspaceId: "anchor" }),
    ]);
    setWorkspaceOrder([
      { kind: "workspace", id: "before" },
      { kind: "workspace", id: "anchor" },
    ]);
    cancelOrderPersist();
    activeWorkspaceIdx.set(1);

    // anchor is at array index 1.
    closeWorkspace(1);

    const list = get(workspaces);
    expect(list.find((w) => w.id === "anchor")).toBeUndefined();
    expect(list.find((w) => w.id === "m1")?.anchorWorkspaceId).toBeUndefined();
    expect(list.find((w) => w.id === "m1")?.memberWorkspaceIds).toEqual(["m2"]);
    expect(list.find((w) => w.id === "m2")?.anchorWorkspaceId).toBe("m1");
    // The promoted member inherits the closed anchor's sidebar slot.
    expect(orderIds()).toEqual(["before", "m1"]);
  });

  it("drops the row for a memberless anchor and detaches a closed member", () => {
    workspaces.set([
      ws("anchor", { memberWorkspaceIds: ["m1"] }),
      ws("m1", { anchorWorkspaceId: "anchor" }),
      ws("lone"),
    ]);
    setWorkspaceOrder([
      { kind: "workspace", id: "anchor" },
      { kind: "workspace", id: "lone" },
    ]);
    cancelOrderPersist();
    activeWorkspaceIdx.set(1);

    // Close the member m1 (array idx 1) — anchor keeps its row, list shrinks.
    closeWorkspace(1);
    const list = get(workspaces);
    expect(list.find((w) => w.id === "m1")).toBeUndefined();
    expect(list.find((w) => w.id === "anchor")?.memberWorkspaceIds).toEqual([]);
    expect(orderIds()).toEqual(["anchor", "lone"]);
  });
});

describe("integration: addMemberToGroup keeps order resolution correct", () => {
  it("a newly-grouped member drops out of the display-order switch targets", () => {
    workspaces.set([ws("a"), ws("b")]);
    setWorkspaceOrder([
      { kind: "workspace", id: "a" },
      { kind: "workspace", id: "b" },
    ]);
    cancelOrderPersist();
    addMemberToGroup("a", "b");
    cancelOrderPersist();
    // b is now nested; only a is a visible switch target.
    expect(orderedAnchorIds()).toEqual(["a"]);
    switchToOrderedWorkspace(0);
    expect(get(activeWorkspaceIdx)).toBe(0);
  });
});
