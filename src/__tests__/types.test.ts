/**
 * Tests for the types module — discriminated union, tree traversal, type guards
 */
import { describe, it, expect } from "vitest";
import {
  uid,
  getAllPanes,
  getAllSurfaces,
  isTerminalSurface,
  isRegistrySurface,
  type Pane,
  type SplitNode,
  type Workspace,
  type TerminalSurface,
  type RegistrySurface,
} from "../lib/types";

function makeMockTerminalSurface(id: string): TerminalSurface {
  return {
    kind: "terminal",
    id,
    ptyId: 1,
    title: `Terminal ${id}`,
    hasUnread: false,
    opened: true,
  };
}

function makeMockRegistrySurface(id: string): RegistrySurface {
  return {
    kind: "registry",
    id,
    surfaceTypeId: "custom-viewer",
    title: `Registry ${id}`,
    hasUnread: false,
    props: { filePath: "/some/path" },
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

describe("isTerminalSurface / isRegistrySurface type guards", () => {
  it("correctly identifies terminal surfaces", () => {
    const ts = makeMockTerminalSurface("t1");
    expect(isTerminalSurface(ts)).toBe(true);
    expect(isRegistrySurface(ts)).toBe(false);
  });

  it("correctly identifies registry surfaces", () => {
    const es = makeMockRegistrySurface("e1");
    expect(isTerminalSurface(es)).toBe(false);
    expect(isRegistrySurface(es)).toBe(true);
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
    expect(panes.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });
});

describe("getAllSurfaces()", () => {
  it("returns all surfaces from a workspace", () => {
    const t1 = makeMockTerminalSurface("t1");
    const e1 = makeMockRegistrySurface("e1");
    const t2 = makeMockTerminalSurface("t2");

    const pane1: Pane = {
      id: "pane1",
      surfaces: [t1, e1],
      activeSurfaceId: "t1",
    };
    const pane2: Pane = { id: "pane2", surfaces: [t2], activeSurfaceId: "t2" };

    const ws: Workspace = {
      id: "ws1",
      name: "Test",
      paneLayout: {
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
    expect(surfaces.map((s) => s.id)).toEqual(["t1", "e1", "t2"]);
  });

  it("correctly mixes terminal and registry surfaces", () => {
    const t1 = makeMockTerminalSurface("t1");
    const e1 = makeMockRegistrySurface("e1");

    const pane: Pane = {
      id: "pane1",
      surfaces: [t1, e1],
      activeSurfaceId: "t1",
    };
    const ws: Workspace = {
      id: "ws1",
      name: "Test",
      paneLayout: { type: "pane", pane },
      activePaneId: "pane1",
    };

    const surfaces = getAllSurfaces(ws);
    expect(surfaces[0].kind).toBe("terminal");
    expect(surfaces[1].kind).toBe("registry");
    expect(isTerminalSurface(surfaces[0])).toBe(true);
    expect(isRegistrySurface(surfaces[1])).toBe(true);
  });
});

describe("RegistrySurface", () => {
  it("isRegistrySurface correctly identifies registry surfaces", () => {
    const es = makeMockRegistrySurface("e1");
    expect(isRegistrySurface(es)).toBe(true);
    expect(isTerminalSurface(es)).toBe(false);
  });

  it("registry surfaces can coexist with terminal surfaces in a pane", () => {
    const t1 = makeMockTerminalSurface("t1");
    const e1 = makeMockRegistrySurface("e1");

    const pane: Pane = {
      id: "pane1",
      surfaces: [t1, e1],
      activeSurfaceId: "t1",
    };
    const ws: Workspace = {
      id: "ws1",
      name: "Test",
      paneLayout: { type: "pane", pane },
      activePaneId: "pane1",
    };

    const surfaces = getAllSurfaces(ws);
    expect(surfaces).toHaveLength(2);
    expect(surfaces[1].kind).toBe("registry");
    expect(isRegistrySurface(surfaces[1])).toBe(true);
  });

  it("registry surface carries surfaceTypeId and arbitrary props", () => {
    const es = makeMockRegistrySurface("e1");
    expect(es.surfaceTypeId).toBe("custom-viewer");
    expect(es.props).toEqual({ filePath: "/some/path" });
  });
});
