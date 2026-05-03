import { describe, it, expect } from "vitest";
import { filterWorkspaces } from "../lib/services/workspace-switcher-filter";
import type { NestedWorkspace } from "../lib/types";
import type { Workspace } from "../lib/config";

// ---- Minimal stubs ----

function makeWs(
  overrides: Partial<NestedWorkspace> & {
    id: string;
    name: string;
    parentWorkspaceId?: string;
  },
): NestedWorkspace {
  const { parentWorkspaceId, ...rest } = overrides;
  return {
    splitRoot: {
      type: "pane",
      pane: { id: "p1", surfaces: [], activeSurfaceId: null },
    },
    activePaneId: "p1",
    ...(parentWorkspaceId ? { metadata: { parentWorkspaceId } } : {}),
    ...rest,
  } as NestedWorkspace;
}

function makeUmbrella(id: string, name: string): Workspace {
  return {
    id,
    name,
    path: "/",
    color: "#fff",
    nestedWorkspaceIds: [],
    isGit: false,
    createdAt: new Date().toISOString(),
  };
}

// ---- Grouped mode setup ----

const umbrellaA = makeUmbrella("ws-a", "Alpha Project");
const umbrellaB = makeUmbrella("ws-b", "Beta Corp");

const umbrellaWorkspaces = [umbrellaA, umbrellaB];

const nestedUnderA = [
  makeWs({ id: "nw-1", name: "main", parentWorkspaceId: "ws-a" }),
  makeWs({ id: "nw-2", name: "feature/login", parentWorkspaceId: "ws-a" }),
];
const nestedUnderB = [
  makeWs({ id: "nw-3", name: "hotfix-db", parentWorkspaceId: "ws-b" }),
  makeWs({ id: "nw-4", name: "develop", parentWorkspaceId: "ws-b" }),
];
const standaloneWs = makeWs({ id: "nw-5", name: "standalone" });

const allWorkspaces = [...nestedUnderA, ...nestedUnderB, standaloneWs];

const parentMap = new Map<string, Workspace>([
  ["ws-a", umbrellaA],
  ["ws-b", umbrellaB],
]);

// ---- Grouped mode tests ----

describe("filterWorkspaces — grouped mode (umbrellaWorkspaces provided)", () => {
  it("returns umbrella rows before their nested rows", () => {
    const result = filterWorkspaces(
      allWorkspaces,
      parentMap,
      "",
      umbrellaWorkspaces,
    );

    const ids = result.map((r) => r.ws.id);
    // Alpha umbrella header before its children
    expect(ids.indexOf("ws-a")).toBeLessThan(ids.indexOf("nw-1"));
    expect(ids.indexOf("ws-a")).toBeLessThan(ids.indexOf("nw-2"));
    // Beta umbrella header before its children
    expect(ids.indexOf("ws-b")).toBeLessThan(ids.indexOf("nw-3"));
    expect(ids.indexOf("ws-b")).toBeLessThan(ids.indexOf("nw-4"));
  });

  it("umbrella rows have kind='umbrella' and depth=0", () => {
    const result = filterWorkspaces(
      allWorkspaces,
      parentMap,
      "",
      umbrellaWorkspaces,
    );
    const umbrellaRows = result.filter((r) => r.kind === "umbrella");

    expect(umbrellaRows).toHaveLength(2);
    for (const row of umbrellaRows) {
      expect(row.depth).toBe(0);
      expect(row.wsId).toBeDefined();
    }
  });

  it("nested rows under an umbrella have kind='nested' and depth=1", () => {
    const result = filterWorkspaces(
      allWorkspaces,
      parentMap,
      "",
      umbrellaWorkspaces,
    );
    const depth1Rows = result.filter(
      (r) => r.kind === "nested" && r.depth === 1,
    );

    // All four nested-under-umbrella workspaces
    expect(depth1Rows).toHaveLength(4);
    expect(depth1Rows.map((r) => r.ws.id)).toEqual(
      expect.arrayContaining(["nw-1", "nw-2", "nw-3", "nw-4"]),
    );
  });

  it("standalone nested rows have depth=0", () => {
    const result = filterWorkspaces(
      allWorkspaces,
      parentMap,
      "",
      umbrellaWorkspaces,
    );
    const standaloneRow = result.find((r) => r.ws.id === "nw-5");

    expect(standaloneRow).toBeDefined();
    expect(standaloneRow!.depth).toBe(0);
    expect(standaloneRow!.kind).toBe("nested");
  });

  it("filter with umbrella name matches the umbrella row and all its children", () => {
    const result = filterWorkspaces(
      allWorkspaces,
      parentMap,
      "alpha",
      umbrellaWorkspaces,
    );

    expect(result.some((r) => r.ws.id === "ws-a")).toBe(true);
    expect(result.some((r) => r.ws.id === "nw-1")).toBe(true);
    expect(result.some((r) => r.ws.id === "nw-2")).toBe(true);
    // Beta and its children should not appear
    expect(result.some((r) => r.ws.id === "ws-b")).toBe(false);
    expect(result.some((r) => r.ws.id === "nw-3")).toBe(false);
  });

  it("filter with nested workspace name returns only that row and its umbrella parent", () => {
    const result = filterWorkspaces(
      allWorkspaces,
      parentMap,
      "hotfix",
      umbrellaWorkspaces,
    );

    // hotfix-db is under Beta — umbrella row should be included
    expect(result.some((r) => r.ws.id === "ws-b")).toBe(true);
    expect(result.some((r) => r.ws.id === "nw-3")).toBe(true);
    // Other Beta children should NOT appear
    expect(result.some((r) => r.ws.id === "nw-4")).toBe(false);
    // Alpha and its children should not appear
    expect(result.some((r) => r.ws.id === "ws-a")).toBe(false);
  });

  it("umbrella row always precedes its matching nested rows after filtering", () => {
    const result = filterWorkspaces(
      allWorkspaces,
      parentMap,
      "feature",
      umbrellaWorkspaces,
    );

    const ids = result.map((r) => r.ws.id);
    expect(ids.indexOf("ws-a")).toBeLessThan(ids.indexOf("nw-2"));
  });

  it("preserves original flat indices on nested rows", () => {
    // nw-3 is at index 2 in allWorkspaces
    const result = filterWorkspaces(
      allWorkspaces,
      parentMap,
      "hotfix",
      umbrellaWorkspaces,
    );
    const row = result.find((r) => r.ws.id === "nw-3");

    expect(row).toBeDefined();
    expect(row!.idx).toBe(2);
  });

  it("umbrella rows have idx=-1", () => {
    const result = filterWorkspaces(
      allWorkspaces,
      parentMap,
      "",
      umbrellaWorkspaces,
    );
    const umbrellaRows = result.filter((r) => r.kind === "umbrella");

    for (const row of umbrellaRows) {
      expect(row.idx).toBe(-1);
    }
  });

  it("returns empty array when no match", () => {
    const result = filterWorkspaces(
      allWorkspaces,
      parentMap,
      "zzznomatch",
      umbrellaWorkspaces,
    );
    expect(result).toHaveLength(0);
  });

  it("standalone nested row matches by name only", () => {
    const result = filterWorkspaces(
      allWorkspaces,
      parentMap,
      "standalone",
      umbrellaWorkspaces,
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.ws.id).toBe("nw-5");
  });
});

// ---- Flat mode tests (backward compatibility: no umbrellaWorkspaces param) ----

describe("filterWorkspaces — flat mode (no umbrellaWorkspaces)", () => {
  const branches = [
    makeWs({ id: "nw-1", name: "main", parentWorkspaceId: "ws-a" }),
    makeWs({ id: "nw-2", name: "feature/login", parentWorkspaceId: "ws-a" }),
    makeWs({ id: "nw-3", name: "hotfix-db", parentWorkspaceId: "ws-b" }),
    makeWs({ id: "nw-4", name: "develop", parentWorkspaceId: "ws-b" }),
    makeWs({ id: "nw-5", name: "standalone" }),
  ];

  const flatParentMap = new Map<string, Workspace>([
    ["ws-a", makeUmbrella("ws-a", "Alpha Project")],
    ["ws-b", makeUmbrella("ws-b", "Beta Corp")],
  ]);

  it("returns all workspaces when query is empty", () => {
    const result = filterWorkspaces(branches, flatParentMap, "");
    expect(result).toHaveLength(branches.length);
    expect(result.map((r) => r.ws.id)).toEqual(branches.map((w) => w.id));
  });

  it("returns all workspaces when query is whitespace-only", () => {
    const result = filterWorkspaces(branches, flatParentMap, "   ");
    expect(result).toHaveLength(branches.length);
  });

  it("filters on branch name (case-insensitive)", () => {
    const result = filterWorkspaces(branches, flatParentMap, "FEATURE");
    expect(result).toHaveLength(1);
    expect(result[0]!.ws.id).toBe("nw-2");
  });

  it("filters on parent workspace name", () => {
    const result = filterWorkspaces(branches, flatParentMap, "alpha");
    // "Alpha Project" matches nw-1 and nw-2
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.ws.id)).toContain("nw-1");
    expect(result.map((r) => r.ws.id)).toContain("nw-2");
  });

  it("is case-insensitive on parent name", () => {
    const lower = filterWorkspaces(branches, flatParentMap, "beta");
    const upper = filterWorkspaces(branches, flatParentMap, "BETA");
    expect(lower).toHaveLength(upper.length);
    expect(lower.map((r) => r.ws.id)).toEqual(upper.map((r) => r.ws.id));
  });

  it("preserves original indices for switchNestedWorkspace", () => {
    const result = filterWorkspaces(branches, flatParentMap, "hotfix");
    expect(result).toHaveLength(1);
    expect(result[0]!.idx).toBe(2); // "hotfix-db" is at index 2
  });

  it("returns empty array when no match", () => {
    const result = filterWorkspaces(branches, flatParentMap, "zzznomatch");
    expect(result).toHaveLength(0);
  });

  it("handles workspaces with no parent gracefully", () => {
    const result = filterWorkspaces(branches, flatParentMap, "standalone");
    expect(result).toHaveLength(1);
    expect(result[0]!.parentLabel).toBe("");
  });

  it("attaches parentLabel correctly", () => {
    const result = filterWorkspaces(branches, flatParentMap, "develop");
    expect(result).toHaveLength(1);
    expect(result[0]!.parentLabel).toBe("Beta Corp");
  });

  it("all flat rows have kind='nested' and depth=0", () => {
    const result = filterWorkspaces(branches, flatParentMap, "");
    for (const row of result) {
      expect(row.kind).toBe("nested");
      expect(row.depth).toBe(0);
    }
  });
});
