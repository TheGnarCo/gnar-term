/**
 * Unit tests for pane-service: resizeActivePane (S7) and the
 * spatial focusDirection (S5).
 *
 * The spatial implementation reads each pane's
 * `element.getBoundingClientRect()`. We mock `pane.element` with a
 * minimal stub that returns fake DOMRect-like objects, since jsdom
 * doesn't lay out our split tree.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";
import {
  nestedWorkspaces,
  activeNestedWorkspaceIdx,
} from "../../stores/nested-workspace";
import { focusDirection, resizeActivePane } from "../pane-service";
import type { NestedWorkspace, Pane, SplitNode } from "../../types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

function pane(id: string, rect?: Partial<DOMRect>): Pane {
  const p: Pane = { id, surfaces: [], activeSurfaceId: null };
  if (rect) {
    const r: DOMRect = {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
      ...rect,
    } as DOMRect;
    p.element = { getBoundingClientRect: () => r } as unknown as HTMLElement;
  }
  return p;
}

function paneNode(p: Pane): SplitNode {
  return { type: "pane", pane: p };
}

function split(
  direction: "horizontal" | "vertical",
  a: SplitNode,
  b: SplitNode,
  ratio = 0.5,
): SplitNode {
  return { type: "split", direction, children: [a, b], ratio };
}

function setupWorkspace(splitRoot: SplitNode, activePaneId: string) {
  const ws: NestedWorkspace = {
    id: "ws-1",
    name: "ws-1",
    splitRoot,
    activePaneId,
  };
  nestedWorkspaces.set([ws]);
  activeNestedWorkspaceIdx.set(0);
  return ws;
}

beforeEach(() => {
  nestedWorkspaces.set([]);
  activeNestedWorkspaceIdx.set(-1);
});

describe("resizeActivePane", () => {
  it("increases ratio when arrow matches the split axis (horizontal+right)", () => {
    const a = pane("a");
    const b = pane("b");
    setupWorkspace(split("horizontal", paneNode(a), paneNode(b)), "a");

    resizeActivePane("right");

    const root = get(nestedWorkspaces)[0]!.splitRoot;
    expect(root.type).toBe("split");
    if (root.type === "split") expect(root.ratio).toBeCloseTo(0.55, 5);
  });

  it("decreases ratio when arrow matches axis in the opposite direction (horizontal+left)", () => {
    const a = pane("a");
    const b = pane("b");
    setupWorkspace(split("horizontal", paneNode(a), paneNode(b)), "b");

    resizeActivePane("left");

    const root = get(nestedWorkspaces)[0]!.splitRoot;
    if (root.type === "split") expect(root.ratio).toBeCloseTo(0.45, 5);
  });

  it("is a no-op when arrow direction is perpendicular to the split axis", () => {
    const a = pane("a");
    const b = pane("b");
    setupWorkspace(split("horizontal", paneNode(a), paneNode(b)), "a");

    resizeActivePane("up");

    const root = get(nestedWorkspaces)[0]!.splitRoot;
    if (root.type === "split") expect(root.ratio).toBe(0.5);
  });

  it("is a no-op when the active pane has no split parent (single pane)", () => {
    const a = pane("a");
    setupWorkspace(paneNode(a), "a");

    expect(() => resizeActivePane("right")).not.toThrow();
    const root = get(nestedWorkspaces)[0]!.splitRoot;
    expect(root.type).toBe("pane");
  });

  it("clamps ratio to a maximum of 0.9", () => {
    const a = pane("a");
    const b = pane("b");
    setupWorkspace(split("horizontal", paneNode(a), paneNode(b), 0.88), "a");

    resizeActivePane("right"); // would be 0.93, clamps to 0.9

    const root = get(nestedWorkspaces)[0]!.splitRoot;
    if (root.type === "split") expect(root.ratio).toBeCloseTo(0.9, 5);
  });

  it("clamps ratio to a minimum of 0.1", () => {
    const a = pane("a");
    const b = pane("b");
    setupWorkspace(split("horizontal", paneNode(a), paneNode(b), 0.12), "a");

    resizeActivePane("left"); // would be 0.07, clamps to 0.1

    const root = get(nestedWorkspaces)[0]!.splitRoot;
    if (root.type === "split") expect(root.ratio).toBeCloseTo(0.1, 5);
  });

  it("works on vertical splits with up/down", () => {
    const a = pane("a");
    const b = pane("b");
    setupWorkspace(split("vertical", paneNode(a), paneNode(b)), "a");

    resizeActivePane("down");

    const root = get(nestedWorkspaces)[0]!.splitRoot;
    if (root.type === "split") expect(root.ratio).toBeCloseTo(0.55, 5);
  });
});

describe("focusDirection (spatial)", () => {
  it("selects the spatially-right pane in a 2-pane horizontal split", () => {
    // [ A | B ]
    const a = pane("a", { left: 0, right: 100, top: 0, bottom: 100 });
    const b = pane("b", { left: 100, right: 200, top: 0, bottom: 100 });
    setupWorkspace(split("horizontal", paneNode(a), paneNode(b)), "a");

    focusDirection("right");

    expect(get(nestedWorkspaces)[0]!.activePaneId).toBe("b");
  });

  it("selects the spatially-correct pane in a 3-pane layout, not the DFS-next", () => {
    // Layout: A on the left (full height), right side split into B (top) and C (bottom).
    // DFS order: A, B, C. From A, "right" should pick the spatially-aligned
    // right neighbour by vertical center.
    // A's vertical center is at y=50 (its full extent is 0..100).
    // B center y=25, C center y=75. So "right" from A → B (closer center).
    const a = pane("a", { left: 0, right: 100, top: 0, bottom: 100 });
    const b = pane("b", { left: 100, right: 200, top: 0, bottom: 50 });
    const c = pane("c", { left: 100, right: 200, top: 50, bottom: 100 });
    const rightSplit = split("vertical", paneNode(b), paneNode(c));
    setupWorkspace(split("horizontal", paneNode(a), rightSplit), "a");

    focusDirection("right");

    expect(get(nestedWorkspaces)[0]!.activePaneId).toBe("b");
  });

  it("'left' from the bottom-right pane picks the spatially-left pane, not the DFS-prev sibling", () => {
    // Layout: A on the left (full height), right side split into B (top) and C (bottom).
    // DFS order: A, B, C. From C, DFS-prev = B (spatially ABOVE c). The spatial
    // implementation should instead pick A (which is to the LEFT of c).
    const a = pane("a", { left: 0, right: 100, top: 0, bottom: 100 });
    const b = pane("b", { left: 100, right: 200, top: 0, bottom: 50 });
    const c = pane("c", { left: 100, right: 200, top: 50, bottom: 100 });
    const rightSplit = split("vertical", paneNode(b), paneNode(c));
    setupWorkspace(split("horizontal", paneNode(a), rightSplit), "c");

    focusDirection("left");

    expect(get(nestedWorkspaces)[0]!.activePaneId).toBe("a");
  });

  it("from the bottom-right pane, 'right' has no spatial candidate and falls back to DFS wrap", () => {
    // Same layout as above. From C, no pane is to the right → DFS fallback.
    // DFS order: A, B, C. "right" from C → wrap to A.
    const a = pane("a", { left: 0, right: 100, top: 0, bottom: 100 });
    const b = pane("b", { left: 100, right: 200, top: 0, bottom: 50 });
    const c = pane("c", { left: 100, right: 200, top: 50, bottom: 100 });
    const rightSplit = split("vertical", paneNode(b), paneNode(c));
    setupWorkspace(split("horizontal", paneNode(a), rightSplit), "c");

    focusDirection("right");

    expect(get(nestedWorkspaces)[0]!.activePaneId).toBe("a");
  });

  it("'down' from a top pane selects the directly-below pane", () => {
    // A on top, B on bottom (vertical split).
    const a = pane("a", { left: 0, right: 100, top: 0, bottom: 50 });
    const b = pane("b", { left: 0, right: 100, top: 50, bottom: 100 });
    setupWorkspace(split("vertical", paneNode(a), paneNode(b)), "a");

    focusDirection("down");

    expect(get(nestedWorkspaces)[0]!.activePaneId).toBe("b");
  });

  it("is a no-op when there is only one pane", () => {
    const a = pane("a", { left: 0, right: 100, top: 0, bottom: 100 });
    setupWorkspace(paneNode(a), "a");

    focusDirection("right");

    expect(get(nestedWorkspaces)[0]!.activePaneId).toBe("a");
  });
});
