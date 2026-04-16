/**
 * Tree utility tests — exercises findParentSplit and replaceNodeInTree
 * with real tree structures to verify split/collapse operations work correctly.
 */

import { describe, it, expect } from "vitest";
import {
  findParentSplit,
  replaceNodeInTree,
  getAllPanes,
  type SplitNode,
  type Pane,
} from "../lib/types";

function makePane(id: string): Pane {
  return { id, surfaces: [], activeSurfaceId: null };
}

function makePaneNode(id: string): SplitNode & { type: "pane" } {
  return { type: "pane", pane: makePane(id) };
}

function makeSplit(
  dir: "horizontal" | "vertical",
  left: SplitNode,
  right: SplitNode,
): SplitNode & { type: "split" } {
  return { type: "split", direction: dir, children: [left, right], ratio: 0.5 };
}

describe("findParentSplit", () => {
  it("returns null for a single pane (no parent split)", () => {
    const root = makePaneNode("A");
    expect(findParentSplit(root, "A")).toBeNull();
  });

  it("finds parent of left child in a simple split", () => {
    const left = makePaneNode("A");
    const right = makePaneNode("B");
    const root = makeSplit("horizontal", left, right);

    const result = findParentSplit(root, "A");
    expect(result).not.toBeNull();
    expect(result!.parent).toBe(root);
    expect(result!.index).toBe(0);
  });

  it("finds parent of right child in a simple split", () => {
    const left = makePaneNode("A");
    const right = makePaneNode("B");
    const root = makeSplit("horizontal", left, right);

    const result = findParentSplit(root, "B");
    expect(result).not.toBeNull();
    expect(result!.parent).toBe(root);
    expect(result!.index).toBe(1);
  });

  it("finds parent in a nested tree (3 levels deep)", () => {
    //       root
    //      /    \
    //   inner    C
    //   /   \
    //  A     B
    const innerLeft = makePaneNode("A");
    const innerRight = makePaneNode("B");
    const inner = makeSplit("vertical", innerLeft, innerRight);
    const right = makePaneNode("C");
    const root = makeSplit("horizontal", inner, right);

    // Find parent of A — should be the inner split
    const resultA = findParentSplit(root, "A");
    expect(resultA).not.toBeNull();
    expect(resultA!.parent).toBe(inner);
    expect(resultA!.index).toBe(0);

    // Find parent of C — should be root
    const resultC = findParentSplit(root, "C");
    expect(resultC).not.toBeNull();
    expect(resultC!.parent).toBe(root);
    expect(resultC!.index).toBe(1);
  });

  it("returns null for a pane ID that doesn't exist", () => {
    const root = makeSplit("horizontal", makePaneNode("A"), makePaneNode("B"));
    expect(findParentSplit(root, "nonexistent")).toBeNull();
  });
});

describe("replaceNodeInTree", () => {
  it("replaces left child by reference", () => {
    const left = makePaneNode("A");
    const right = makePaneNode("B");
    const root = makeSplit("horizontal", left, right);
    const replacement = makePaneNode("X");

    const found = replaceNodeInTree(root, left, replacement);
    expect(found).toBe(true);
    expect(root.children[0]).toBe(replacement);
    expect(root.children[1]).toBe(right); // untouched
  });

  it("replaces right child by reference", () => {
    const left = makePaneNode("A");
    const right = makePaneNode("B");
    const root = makeSplit("horizontal", left, right);
    const replacement = makePaneNode("Y");

    const found = replaceNodeInTree(root, right, replacement);
    expect(found).toBe(true);
    expect(root.children[1]).toBe(replacement);
  });

  it("replaces a nested split node (used when collapsing panes)", () => {
    //       root
    //      /    \
    //   inner    C
    //   /   \
    //  A     B
    const inner = makeSplit("vertical", makePaneNode("A"), makePaneNode("B"));
    const right = makePaneNode("C");
    const root = makeSplit("horizontal", inner, right);

    // Collapse inner by replacing it with just pane B (simulating pane A removal)
    const paneB = inner.children[1];
    const found = replaceNodeInTree(root, inner, paneB);
    expect(found).toBe(true);
    expect(root.children[0]).toBe(paneB);
    // Tree is now: root → [B, C]
    expect(getAllPanes(root).map((p) => p.id)).toEqual(["B", "C"]);
  });

  it("returns false when target is not found", () => {
    const root = makeSplit("horizontal", makePaneNode("A"), makePaneNode("B"));
    const orphan = makePaneNode("Z");
    expect(replaceNodeInTree(root, orphan, makePaneNode("X"))).toBe(false);
  });

  it("returns false for a single pane node (nothing to replace)", () => {
    const root = makePaneNode("A");
    expect(replaceNodeInTree(root, root, makePaneNode("X"))).toBe(false);
  });
});

describe("split + collapse integration", () => {
  it("splitting a pane then closing one restores the original structure", () => {
    // Start: root → pane A
    const paneA = makePaneNode("A");
    let root: SplitNode = paneA;

    // Split pane A → root becomes split [A, B]
    const paneB = makePaneNode("B");
    const split = makeSplit("horizontal", paneA, paneB);
    root = split;
    expect(getAllPanes(root).map((p) => p.id)).toEqual(["A", "B"]);

    // Close pane B → collapse split, root becomes pane A again
    const parentInfo = findParentSplit(root, "B");
    expect(parentInfo).not.toBeNull();
    const sibling =
      parentInfo!.parent.type === "split"
        ? parentInfo!.parent.children[parentInfo!.index === 0 ? 1 : 0]
        : null;
    // Since root === parentInfo.parent, replace root directly
    if (root === parentInfo!.parent) {
      root = sibling!;
    }
    expect(root.type).toBe("pane");
    expect(getAllPanes(root).map((p) => p.id)).toEqual(["A"]);
  });

  it("closing a deeply nested pane collapses correctly", () => {
    //       root
    //      /    \
    //   inner    C
    //   /   \
    //  A     B
    const inner = makeSplit("vertical", makePaneNode("A"), makePaneNode("B"));
    const paneC = makePaneNode("C");
    const root = makeSplit("horizontal", inner, paneC);

    // Close pane A: find parent (inner), get sibling (B), replace inner with B
    const parentInfo = findParentSplit(root, "A")!;
    expect(parentInfo.parent).toBe(inner);
    const sibling =
      parentInfo.parent.type === "split"
        ? parentInfo.parent.children[parentInfo.index === 0 ? 1 : 0]
        : null;

    // inner !== root, so use replaceNodeInTree
    replaceNodeInTree(root, parentInfo.parent, sibling!);
    // Tree is now: root → [B, C]
    expect(getAllPanes(root).map((p) => p.id)).toEqual(["B", "C"]);
  });
});
