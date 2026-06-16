/**
 * sidebar-tree.test.ts — the nested workspace tree (Stage 3).
 *
 * Verifies the anchor row renders as the group header, the collapse
 * chevron toggles the shared groupCollapsedState, members render indented
 * under their anchor, a standalone workspace renders as a degenerate group
 * (no chevron / no member block), and the DropGhost is rail-flush.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/svelte";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.stubGlobal("localStorage", {
  getItem: vi.fn().mockReturnValue(null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
});

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal("ResizeObserver", MockResizeObserver);

// jsdom has no Web Animations API — Svelte's `slide` transition (member
// block expand) calls element.animate(). Stub it so the transition is a
// no-op rather than throwing.
if (typeof Element !== "undefined" && !Element.prototype.animate) {
  Element.prototype.animate = vi.fn().mockReturnValue({
    cancel: vi.fn(),
    finished: Promise.resolve(),
    onfinish: null,
  }) as unknown as Element["animate"];
}

import WorkspaceList from "../lib/components/WorkspaceList.svelte";
import WorkspaceGroup from "../lib/components/WorkspaceGroup.svelte";
import DropGhost from "../lib/components/DropGhost.svelte";
import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import {
  setWorkspaceOrder,
  cancelOrderPersist,
} from "../lib/stores/workspace-order";
import { groupCollapsedState, setGroupCollapsed, sidebarVisible } from "../lib/stores/ui";
import type { Workspace, Pane } from "../lib/types";

function makeWorkspace(id: string, name: string, extra: Partial<Workspace> = {}): Workspace {
  const pane: Pane = { id: `${id}-p`, surfaces: [], activeSurfaceId: null };
  return {
    id,
    name,
    splitRoot: { type: "pane", pane },
    activePaneId: pane.id,
    ...extra,
  };
}

/** Seed a group: one anchor with N members tagged + ordered. */
function seedGroup(
  anchorId: string,
  anchorName: string,
  members: Array<[string, string]>,
): void {
  const memberIds = members.map(([id]) => id);
  const anchor = makeWorkspace(anchorId, anchorName, {
    memberWorkspaceIds: memberIds,
  });
  const memberWs = members.map(([id, name]) =>
    makeWorkspace(id, name, { anchorWorkspaceId: anchorId }),
  );
  workspaces.set([anchor, ...memberWs]);
  setWorkspaceOrder([{ kind: "workspace", id: anchorId }]);
  cancelOrderPersist();
}

beforeEach(() => {
  cleanup();
  workspaces.set([]);
  activeWorkspaceIdx.set(-1);
  setWorkspaceOrder([]);
  cancelOrderPersist();
  groupCollapsedState.set(new Map());
  sidebarVisible.set(true);
});

describe("anchor row", () => {
  it("renders the anchor's name as the group header", () => {
    seedGroup("a1", "Anchor One", [["m1", "Member One"]]);
    const { container } = render(WorkspaceList);
    expect(screen.getByText("Anchor One")).toBeTruthy();
    // The anchor row IS the group header — marked data-workspace-group.
    const group = container.querySelector('[data-workspace-group="a1"]');
    expect(group).toBeTruthy();
    expect(group?.getAttribute("data-workspace-group-mode")).toBe("anchor");
    expect(container.querySelector("[data-anchor-row]")).toBeTruthy();
  });

  it("renders one anchor row per workspace-order entry", () => {
    const a1 = makeWorkspace("a1", "Alpha");
    const a2 = makeWorkspace("a2", "Beta");
    workspaces.set([a1, a2]);
    setWorkspaceOrder([
      { kind: "workspace", id: "a1" },
      { kind: "workspace", id: "a2" },
    ]);
    cancelOrderPersist();
    const { container } = render(WorkspaceList);
    expect(container.querySelectorAll("[data-workspace-group]").length).toBe(2);
  });

  it("skips order rows whose workspace no longer exists", () => {
    const a1 = makeWorkspace("a1", "Alpha");
    workspaces.set([a1]);
    setWorkspaceOrder([
      { kind: "workspace", id: "a1" },
      { kind: "workspace", id: "ghost" },
    ]);
    cancelOrderPersist();
    const { container } = render(WorkspaceList);
    expect(container.querySelectorAll("[data-workspace-group]").length).toBe(1);
  });
});

describe("collapse chevron", () => {
  it("toggles groupCollapsedState when clicked", async () => {
    seedGroup("a1", "Anchor", [["m1", "Member"]]);
    render(WorkspaceList);
    // Default collapsed → chevron shows "Expand Group".
    const expandBtn = screen.getByTitle("Expand Group");
    expect(get(groupCollapsedState).get("a1") ?? true).toBe(true);
    await fireEvent.click(expandBtn);
    expect(get(groupCollapsedState).get("a1")).toBe(false);
  });

  it("renders members indented under the anchor when expanded", async () => {
    seedGroup("a1", "Anchor", [
      ["m1", "Member One"],
      ["m2", "Member Two"],
    ]);
    setGroupCollapsed("a1", false);
    const { container } = render(WorkspaceList);
    // The member block is keyed by the anchor's group id.
    const memberBlock = container.querySelector(
      '[data-workspace-group-members="a1"]',
    );
    expect(memberBlock).toBeTruthy();
    expect(screen.getByText("Member One")).toBeTruthy();
    expect(screen.getByText("Member Two")).toBeTruthy();
  });

  it("hides members when collapsed", () => {
    seedGroup("a1", "Anchor", [["m1", "Member One"]]);
    setGroupCollapsed("a1", true);
    render(WorkspaceList);
    expect(screen.queryByText("Member One")).toBeNull();
  });
});

describe("degenerate group (standalone workspace)", () => {
  it("renders no collapse chevron and no member block", () => {
    const a1 = makeWorkspace("a1", "Solo");
    workspaces.set([a1]);
    setWorkspaceOrder([{ kind: "workspace", id: "a1" }]);
    cancelOrderPersist();
    const { container } = render(WorkspaceList);
    expect(screen.getByText("Solo")).toBeTruthy();
    expect(screen.queryByTitle("Expand Group")).toBeNull();
    expect(screen.queryByTitle("Collapse Group")).toBeNull();
    expect(
      container.querySelector('[data-workspace-group-members="a1"]'),
    ).toBeNull();
  });

  it("ignores member ids whose tag no longer points at the anchor", () => {
    // memberWorkspaceIds lists m1, but m1 lost its anchorWorkspaceId tag —
    // membership derives from the tag, so the group is degenerate.
    const anchor = makeWorkspace("a1", "Anchor", { memberWorkspaceIds: ["m1"] });
    const stray = makeWorkspace("m1", "Stray"); // no anchorWorkspaceId
    workspaces.set([anchor, stray]);
    setWorkspaceOrder([{ kind: "workspace", id: "a1" }]);
    cancelOrderPersist();
    render(WorkspaceGroup, { props: { anchor } });
    expect(screen.queryByTitle("Expand Group")).toBeNull();
  });
});

describe("DropGhost rail-flush", () => {
  it("rounds only the right corners and insets only on the right", () => {
    const { container } = render(DropGhost, {
      props: { height: 32, inset: 4, accent: "#abc", label: "Dragged" },
    });
    const ghost = container.firstElementChild as HTMLElement;
    expect(ghost.style.borderRadius).toBe("0 6px 6px 0");
    // jsdom normalizes the shorthand to explicit px units.
    expect(ghost.style.margin).toBe("0px 4px 0px 0px");
    expect(ghost.textContent?.trim()).toBe("Dragged");
  });

  it("renders a grey scrim with no label", () => {
    const { container } = render(DropGhost, {
      props: { height: 24, inset: 8 },
    });
    const ghost = container.firstElementChild as HTMLElement;
    expect(ghost.style.borderRadius).toBe("0 6px 6px 0");
    expect(ghost.textContent?.trim()).toBe("");
  });
});
