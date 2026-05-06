import { describe, it, expect } from "vitest";
import { filterWorkspaces } from "../lib/services/workspace-switcher-filter";
import type { Workspace } from "../lib/types";
import type { WorkspaceRecord } from "../lib/config";

// ---- Minimal stubs ----

function makeWs(
  overrides: Partial<Workspace> & {
    id: string;
    name: string;
    rootWorkspaceId?: string;
  },
): Workspace {
  return {
    paneLayout: {
      type: "pane",
      pane: { id: "p1", surfaces: [], activeSurfaceId: null },
    },
    activePaneId: "p1",
    ...overrides,
  } as Workspace;
}

function makeParent(id: string, name: string): WorkspaceRecord {
  return {
    id,
    name,
    path: "/",
    color: "#fff",
    branchedWorkspaceIds: [],
    isGit: false,
    createdAt: new Date().toISOString(),
  };
}

// ---- Grouped mode setup ----

const parentA = makeParent("ws-a", "Alpha Project");
const parentB = makeParent("ws-b", "Beta Corp");

const parentWorkspaces = [parentA, parentB];

const childrenOfA = [
  makeWs({ id: "nw-1", name: "main", rootWorkspaceId: "ws-a" }),
  makeWs({ id: "nw-2", name: "feature/login", rootWorkspaceId: "ws-a" }),
];
const childrenOfB = [
  makeWs({ id: "nw-3", name: "hotfix-db", rootWorkspaceId: "ws-b" }),
  makeWs({ id: "nw-4", name: "develop", rootWorkspaceId: "ws-b" }),
];
const standaloneWs = makeWs({ id: "nw-5", name: "standalone" });

const allWorkspaces = [...childrenOfA, ...childrenOfB, standaloneWs];

const parentMap = new Map<string, WorkspaceRecord>([
  ["ws-a", parentA],
  ["ws-b", parentB],
]);

// ---- Grouped mode tests ----

describe("filterWorkspaces — child ordering within parent groups", () => {
  it("sorts: main workspace first, branches second, dashboards last", () => {
    const parent = makeParent("ws-x", "My Project");
    const dashboard = makeWs({
      id: "nw-dash",
      name: "Dashboard",
      rootWorkspaceId: "ws-x",
      isDashboard: true,
    });
    const branch = makeWs({
      id: "nw-branch",
      name: "feat/thing",
      rootWorkspaceId: "ws-x",
      worktreePath: "/some/path",
      branch: "feat/thing",
    } as Workspace & { worktreePath?: string; branch?: string });
    const main = makeWs({
      id: "nw-main",
      name: "main",
      rootWorkspaceId: "ws-x",
    });

    // Supply in wrong order: dashboard, branch, main
    const result = filterWorkspaces(
      [dashboard, branch, main],
      new Map([["ws-x", parent]]),
      "",
      [parent],
    );

    const ids = result.filter((r) => r.kind === "child").map((r) => r.ws.id);
    expect(ids).toEqual(["nw-main", "nw-branch", "nw-dash"]);
  });
});

describe("filterWorkspaces — grouped mode (parentWorkspaces provided)", () => {
  it("returns parent rows before their child rows", () => {
    const result = filterWorkspaces(
      allWorkspaces,
      parentMap,
      "",
      parentWorkspaces,
    );

    const ids = result.map((r) => r.ws.id);
    // Alpha parent header before its children
    expect(ids.indexOf("ws-a")).toBeLessThan(ids.indexOf("nw-1"));
    expect(ids.indexOf("ws-a")).toBeLessThan(ids.indexOf("nw-2"));
    // Beta parent header before its children
    expect(ids.indexOf("ws-b")).toBeLessThan(ids.indexOf("nw-3"));
    expect(ids.indexOf("ws-b")).toBeLessThan(ids.indexOf("nw-4"));
  });

  it("parent rows have kind='parent' and depth=0", () => {
    const result = filterWorkspaces(
      allWorkspaces,
      parentMap,
      "",
      parentWorkspaces,
    );
    const parentRows = result.filter((r) => r.kind === "parent");

    expect(parentRows).toHaveLength(2);
    for (const row of parentRows) {
      expect(row.depth).toBe(0);
      expect(row.wsId).toBeDefined();
    }
  });

  it("child rows under a parent have kind='child' and depth=1", () => {
    const result = filterWorkspaces(
      allWorkspaces,
      parentMap,
      "",
      parentWorkspaces,
    );
    const depth1Rows = result.filter(
      (r) => r.kind === "child" && r.depth === 1,
    );

    // All four child-under-Workspaces
    expect(depth1Rows).toHaveLength(4);
    expect(depth1Rows.map((r) => r.ws.id)).toEqual(
      expect.arrayContaining(["nw-1", "nw-2", "nw-3", "nw-4"]),
    );
  });

  it("standalone child rows have depth=0", () => {
    const result = filterWorkspaces(
      allWorkspaces,
      parentMap,
      "",
      parentWorkspaces,
    );
    const standaloneRow = result.find((r) => r.ws.id === "nw-5");

    expect(standaloneRow).toBeDefined();
    expect(standaloneRow!.depth).toBe(0);
    expect(standaloneRow!.kind).toBe("child");
  });

  it("filter with parent name matches the parent row and all its children", () => {
    const result = filterWorkspaces(
      allWorkspaces,
      parentMap,
      "alpha",
      parentWorkspaces,
    );

    expect(result.some((r) => r.ws.id === "ws-a")).toBe(true);
    expect(result.some((r) => r.ws.id === "nw-1")).toBe(true);
    expect(result.some((r) => r.ws.id === "nw-2")).toBe(true);
    // Beta and its children should not appear
    expect(result.some((r) => r.ws.id === "ws-b")).toBe(false);
    expect(result.some((r) => r.ws.id === "nw-3")).toBe(false);
  });

  it("filter with child workspace name returns only that row and its parent parent", () => {
    const result = filterWorkspaces(
      allWorkspaces,
      parentMap,
      "hotfix",
      parentWorkspaces,
    );

    // hotfix-db is under Beta — parent row should be included
    expect(result.some((r) => r.ws.id === "ws-b")).toBe(true);
    expect(result.some((r) => r.ws.id === "nw-3")).toBe(true);
    // Other Beta children should NOT appear
    expect(result.some((r) => r.ws.id === "nw-4")).toBe(false);
    // Alpha and its children should not appear
    expect(result.some((r) => r.ws.id === "ws-a")).toBe(false);
  });

  it("parent row always precedes its matching child rows after filtering", () => {
    const result = filterWorkspaces(
      allWorkspaces,
      parentMap,
      "feature",
      parentWorkspaces,
    );

    const ids = result.map((r) => r.ws.id);
    expect(ids.indexOf("ws-a")).toBeLessThan(ids.indexOf("nw-2"));
  });

  it("preserves original flat indices on child rows", () => {
    // nw-3 is at index 2 in allWorkspaces
    const result = filterWorkspaces(
      allWorkspaces,
      parentMap,
      "hotfix",
      parentWorkspaces,
    );
    const row = result.find((r) => r.ws.id === "nw-3");

    expect(row).toBeDefined();
    expect(row!.idx).toBe(2);
  });

  it("parent rows have idx=-1", () => {
    const result = filterWorkspaces(
      allWorkspaces,
      parentMap,
      "",
      parentWorkspaces,
    );
    const parentRows = result.filter((r) => r.kind === "parent");

    for (const row of parentRows) {
      expect(row.idx).toBe(-1);
    }
  });

  it("returns empty array when no match", () => {
    const result = filterWorkspaces(
      allWorkspaces,
      parentMap,
      "zzznomatch",
      parentWorkspaces,
    );
    expect(result).toHaveLength(0);
  });

  it("standalone child row matches by name only", () => {
    const result = filterWorkspaces(
      allWorkspaces,
      parentMap,
      "standalone",
      parentWorkspaces,
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.ws.id).toBe("nw-5");
  });
});

// ---- Flat mode tests (backward compatibility: no parentWorkspaces param) ----

describe("filterWorkspaces — flat mode (no parentWorkspaces)", () => {
  const branches = [
    makeWs({ id: "nw-1", name: "main", rootWorkspaceId: "ws-a" }),
    makeWs({ id: "nw-2", name: "feature/login", rootWorkspaceId: "ws-a" }),
    makeWs({ id: "nw-3", name: "hotfix-db", rootWorkspaceId: "ws-b" }),
    makeWs({ id: "nw-4", name: "develop", rootWorkspaceId: "ws-b" }),
    makeWs({ id: "nw-5", name: "standalone" }),
  ];

  const flatParentMap = new Map<string, WorkspaceRecord>([
    ["ws-a", makeParent("ws-a", "Alpha Project")],
    ["ws-b", makeParent("ws-b", "Beta Corp")],
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

  it("filters on Workspace name", () => {
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

  it("preserves original indices for switchWorkspace", () => {
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

  it("all flat rows have kind='child' and depth=0", () => {
    const result = filterWorkspaces(branches, flatParentMap, "");
    for (const row of result) {
      expect(row.kind).toBe("child");
      expect(row.depth).toBe(0);
    }
  });
});
