/**
 * Tab drag-and-drop tests — verify the pane-service mutations that back the
 * mouse-driven tab drag (cross-pane merge, directional surface-split, source
 * collapse) and that commitTabDrop dispatches to the right one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/config", () => ({
  getConfig: () => ({}),
  saveConfig: vi.fn().mockResolvedValue(undefined),
}));

import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import type {
  Workspace,
  Pane,
  Surface,
  SplitNode,
  TerminalSurface,
} from "../lib/types";
import { getAllPanes, findPaneInWorkspace } from "../lib/types";
import {
  mergeTabToPane,
  splitPaneWithSurface,
} from "../lib/services/pane-service";
import {
  commitTabDrop,
  __setTabDropTargetForTest,
} from "../lib/services/tab-drag";

function term(id: string): TerminalSurface {
  return {
    kind: "terminal",
    id,
    terminal: { focus: vi.fn() } as any,
    fitAddon: {} as any,
    searchAddon: {} as any,
    termElement: document.createElement("div"),
    ptyId: 1,
    title: id,
    hasUnread: false,
    opened: true,
  };
}

function pane(id: string, surfaces: Surface[]): Pane {
  return { id, surfaces, activeSurfaceId: surfaces[0]?.id ?? null };
}

// Workspace: horizontal split of p1 [s1, s2] | p2 [s3].
function buildWorkspace(): Workspace {
  const splitRoot: SplitNode = {
    type: "split",
    direction: "horizontal",
    ratio: 0.5,
    children: [
      { type: "pane", pane: pane("p1", [term("s1"), term("s2")]) },
      { type: "pane", pane: pane("p2", [term("s3")]) },
    ],
  };
  return { id: "ws1", name: "ws", splitRoot, activePaneId: "p1" };
}

beforeEach(() => {
  workspaces.set([buildWorkspace()]);
  activeWorkspaceIdx.set(0);
});

describe("mergeTabToPane", () => {
  it("moves a surface into the target pane's tab list and activates it", () => {
    mergeTabToPane("s2", "p1", "p2");
    const ws = get(workspaces)[0];
    const p1 = findPaneInWorkspace(ws, "p1")!;
    const p2 = findPaneInWorkspace(ws, "p2")!;
    expect(p1.surfaces.map((s) => s.id)).toEqual(["s1"]);
    expect(p2.surfaces.map((s) => s.id)).toEqual(["s3", "s2"]);
    expect(p2.activeSurfaceId).toBe("s2");
    expect(ws.activePaneId).toBe("p2");
  });

  it("collapses the source pane when the move empties it", () => {
    // p2 holds only s3 — merging it into p1 empties p2, collapsing the split.
    mergeTabToPane("s3", "p2", "p1");
    const ws = get(workspaces)[0];
    expect(ws.splitRoot.type).toBe("pane");
    if (ws.splitRoot.type === "pane") {
      expect(ws.splitRoot.pane.id).toBe("p1");
      expect(ws.splitRoot.pane.surfaces.map((s) => s.id)).toEqual([
        "s1",
        "s2",
        "s3",
      ]);
    }
    expect(getAllPanes(ws.splitRoot)).toHaveLength(1);
  });

  it("is a no-op when source and target are the same pane", () => {
    mergeTabToPane("s1", "p1", "p1");
    const ws = get(workspaces)[0];
    expect(findPaneInWorkspace(ws, "p1")!.surfaces.map((s) => s.id)).toEqual([
      "s1",
      "s2",
    ]);
  });
});

describe("splitPaneWithSurface", () => {
  it("splits the target pane, placing the dragged surface in a new pane (after)", () => {
    splitPaneWithSurface("s1", "p1", "p2", "vertical", false);
    const ws = get(workspaces)[0];
    // p1 keeps s2; a new pane holding s1 now sits below p2.
    expect(findPaneInWorkspace(ws, "p1")!.surfaces.map((s) => s.id)).toEqual([
      "s2",
    ]);
    const panes = getAllPanes(ws.splitRoot);
    const newPane = panes.find((p) => p.surfaces.some((s) => s.id === "s1"));
    expect(newPane).toBeDefined();
    expect(newPane!.id).not.toBe("p1");
    expect(ws.activePaneId).toBe(newPane!.id);
  });

  it("honors before=true for top/left drops (new pane first)", () => {
    splitPaneWithSurface("s1", "p1", "p2", "horizontal", true);
    const ws = get(workspaces)[0];
    // Find the split node whose target is p2 and confirm the new pane is child 0.
    const panes = getAllPanes(ws.splitRoot);
    const newPane = panes.find((p) => p.surfaces.some((s) => s.id === "s1"))!;
    function findSplitContaining(
      node: SplitNode,
      id: string,
    ): (SplitNode & { type: "split" }) | null {
      if (node.type === "pane") return null;
      const hit = node.children.some(
        (c) => c.type === "pane" && c.pane.id === id,
      );
      if (hit) return node;
      return (
        findSplitContaining(node.children[0], id) ||
        findSplitContaining(node.children[1], id)
      );
    }
    const split = findSplitContaining(ws.splitRoot, newPane.id)!;
    expect(split.children[0].type === "pane" && split.children[0].pane.id).toBe(
      newPane.id,
    );
  });
});

describe("commitTabDrop dispatch", () => {
  it("dispatches a merge drop target to mergeTabToPane", () => {
    __setTabDropTargetForTest({
      surfaceId: "s2",
      sourcePaneId: "p1",
      sourceWorkspaceId: "ws1",
      position: { x: 0, y: 0 },
      dropTarget: { kind: "merge", paneId: "p2" },
    });
    commitTabDrop();
    const ws = get(workspaces)[0];
    expect(findPaneInWorkspace(ws, "p2")!.surfaces.map((s) => s.id)).toEqual([
      "s3",
      "s2",
    ]);
  });

  it("dispatches a surface-split drop target to splitPaneWithSurface", () => {
    __setTabDropTargetForTest({
      surfaceId: "s1",
      sourcePaneId: "p1",
      sourceWorkspaceId: "ws1",
      position: { x: 0, y: 0 },
      dropTarget: { kind: "surface-split", paneId: "p2", zone: "right" },
    });
    commitTabDrop();
    const ws = get(workspaces)[0];
    const newPane = getAllPanes(ws.splitRoot).find((p) =>
      p.surfaces.some((s) => s.id === "s1"),
    )!;
    expect(newPane.id).not.toBe("p1");
  });

  it("is a no-op when there is no drop target", () => {
    __setTabDropTargetForTest(null);
    commitTabDrop();
    const ws = get(workspaces)[0];
    expect(getAllPanes(ws.splitRoot).map((p) => p.id)).toEqual(["p1", "p2"]);
  });
});
