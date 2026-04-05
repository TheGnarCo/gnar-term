/**
 * Tests for the types module — discriminated union, tree traversal, type guards
 */
import { describe, it, expect } from "vitest";
import {
  uid,
  getAllPanes,
  getAllSurfaces,
  isTerminalSurface,
  isPreviewSurface,
  type Pane,
  type SplitNode,
  type Workspace,
  type TerminalSurface,
  type PreviewSurface,
} from "../lib/types";

function makeMockTerminalSurface(id: string): TerminalSurface {
  return {
    kind: "terminal",
    id,
    terminal: {} as any,
    fitAddon: { fit: () => {} } as any,
    searchAddon: {} as any,
    termElement: document.createElement("div"),
    ptyId: 1,
    title: `Terminal ${id}`,
    hasUnread: false,
    opened: true,
  };
}

function makeMockPreviewSurface(id: string): PreviewSurface {
  return {
    kind: "preview",
    id,
    filePath: `/path/${id}.md`,
    title: `Preview ${id}`,
    element: document.createElement("div"),
    watchId: 1,
    hasUnread: false,
  };
}

describe("uid()", () => {
  it("generates unique IDs", () => {
    const ids = new Set([uid(), uid(), uid(), uid(), uid()]);
    expect(ids.size).toBe(5);
  });

  it("IDs start with 'id-'", () => {
    expect(uid()).toMatch(/^id-/);
  });
});

describe("isTerminalSurface / isPreviewSurface type guards", () => {
  it("correctly identifies terminal surfaces", () => {
    const ts = makeMockTerminalSurface("t1");
    expect(isTerminalSurface(ts)).toBe(true);
    expect(isPreviewSurface(ts)).toBe(false);
  });

  it("correctly identifies preview surfaces", () => {
    const ps = makeMockPreviewSurface("p1");
    expect(isTerminalSurface(ps)).toBe(false);
    expect(isPreviewSurface(ps)).toBe(true);
  });
});

describe("getAllPanes()", () => {
  it("returns single pane from leaf node", () => {
    const pane: Pane = { id: "p1", surfaces: [], activeSurfaceId: null };
    const node: SplitNode = { type: "pane", pane };
    expect(getAllPanes(node)).toEqual([pane]);
  });

  it("returns all panes from a split tree", () => {
    const p1: Pane = { id: "p1", surfaces: [], activeSurfaceId: null };
    const p2: Pane = { id: "p2", surfaces: [], activeSurfaceId: null };
    const p3: Pane = { id: "p3", surfaces: [], activeSurfaceId: null };

    const tree: SplitNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { type: "pane", pane: p1 },
        {
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          children: [
            { type: "pane", pane: p2 },
            { type: "pane", pane: p3 },
          ],
        },
      ],
    };

    const panes = getAllPanes(tree);
    expect(panes).toHaveLength(3);
    expect(panes.map(p => p.id)).toEqual(["p1", "p2", "p3"]);
  });
});

describe("getAllSurfaces()", () => {
  it("returns all surfaces from a workspace", () => {
    const t1 = makeMockTerminalSurface("t1");
    const p1 = makeMockPreviewSurface("p1");
    const t2 = makeMockTerminalSurface("t2");

    const pane1: Pane = { id: "pane1", surfaces: [t1, p1], activeSurfaceId: "t1" };
    const pane2: Pane = { id: "pane2", surfaces: [t2], activeSurfaceId: "t2" };

    const ws: Workspace = {
      id: "ws1",
      name: "Test",
      splitRoot: {
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        children: [
          { type: "pane", pane: pane1 },
          { type: "pane", pane: pane2 },
        ],
      },
      activePaneId: "pane1",
    };

    const surfaces = getAllSurfaces(ws);
    expect(surfaces).toHaveLength(3);
    expect(surfaces.map(s => s.id)).toEqual(["t1", "p1", "t2"]);
  });

  it("correctly mixes terminal and preview surfaces", () => {
    const t1 = makeMockTerminalSurface("t1");
    const p1 = makeMockPreviewSurface("p1");

    const pane: Pane = { id: "pane1", surfaces: [t1, p1], activeSurfaceId: "t1" };
    const ws: Workspace = {
      id: "ws1",
      name: "Test",
      splitRoot: { type: "pane", pane },
      activePaneId: "pane1",
    };

    const surfaces = getAllSurfaces(ws);
    expect(surfaces[0].kind).toBe("terminal");
    expect(surfaces[1].kind).toBe("preview");
    expect(isTerminalSurface(surfaces[0])).toBe(true);
    expect(isPreviewSurface(surfaces[1])).toBe(true);
  });
});
