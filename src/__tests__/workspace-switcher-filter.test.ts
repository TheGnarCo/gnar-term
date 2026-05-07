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

function makeRoot(id: string, name: string): WorkspaceRecord {
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

const rootA = makeRoot("ws-a", "Alpha Root");
const rootB = makeRoot("ws-b", "Beta Corp");

const rootWorkspaces = [rootA, rootB];

const branchesOfA = [
  makeWs({ id: "nw-1", name: "main", rootWorkspaceId: "ws-a" }),
  makeWs({ id: "nw-2", name: "feature/login", rootWorkspaceId: "ws-a" }),
];
const branchesOfB = [
  makeWs({ id: "nw-3", name: "hotfix-db", rootWorkspaceId: "ws-b" }),
  makeWs({ id: "nw-4", name: "develop", rootWorkspaceId: "ws-b" }),
];
const standaloneWs = makeWs({ id: "nw-5", name: "standalone" });

const allWorkspaces = [...branchesOfA, ...branchesOfB, standaloneWs];

const rootMap = new Map<string, WorkspaceRecord>([
  ["ws-a", rootA],
  ["ws-b", rootB],
]);

// ---- Grouped mode tests ----

describe("filterWorkspaces — branch ordering within a Root", () => {
  it("sorts: main workspace first, branches second, dashboards last", () => {
    const root = makeRoot("ws-x", "My Root");
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
      new Map([["ws-x", root]]),
      "",
      [root],
    );

    const ids = result.filter((r) => r.kind === "branch").map((r) => r.ws.id);
    expect(ids).toEqual(["nw-main", "nw-branch", "nw-dash"]);
  });

  it("groups the Root workspace itself under its own header, above its dashboards", () => {
    // ADR-004: the Root runtime Workspace shares its id with the Record,
    // and its `rootWorkspaceId` is undefined. It should still appear
    // nested under its own group, sorted as the type-0 main entry.
    const root = makeRoot("ws-x", "Agent Skills");
    const rootSelf = makeWs({ id: "ws-x", name: "Agent Skills" });
    const settings = makeWs({
      id: "nw-settings",
      name: "Settings",
      rootWorkspaceId: "ws-x",
      isDashboard: true,
    });
    const shortcuts = makeWs({
      id: "nw-shortcuts",
      name: "Keyboard Shortcuts",
      rootWorkspaceId: "ws-x",
      isDashboard: true,
    });

    // Supply in wrong order so we know the sort is doing the work.
    const result = filterWorkspaces(
      [settings, rootSelf, shortcuts],
      new Map([["ws-x", root]]),
      "",
      [root],
    );

    // Order: header, root-self (depth=1), dashboards
    expect(result.map((r) => ({ id: r.ws.id, kind: r.kind }))).toEqual([
      { id: "ws-x", kind: "root" },
      { id: "ws-x", kind: "branch" },
      { id: "nw-settings", kind: "branch" },
      { id: "nw-shortcuts", kind: "branch" },
    ]);

    const rootSelfRow = result.find(
      (r) => r.kind === "branch" && r.ws.id === "ws-x",
    );
    expect(rootSelfRow?.depth).toBe(1);
  });
});

describe("filterWorkspaces — grouped mode (rootWorkspaces provided)", () => {
  it("returns root rows before their branch rows", () => {
    const result = filterWorkspaces(allWorkspaces, rootMap, "", rootWorkspaces);

    const ids = result.map((r) => r.ws.id);
    // Alpha root header before its branches
    expect(ids.indexOf("ws-a")).toBeLessThan(ids.indexOf("nw-1"));
    expect(ids.indexOf("ws-a")).toBeLessThan(ids.indexOf("nw-2"));
    // Beta root header before its branches
    expect(ids.indexOf("ws-b")).toBeLessThan(ids.indexOf("nw-3"));
    expect(ids.indexOf("ws-b")).toBeLessThan(ids.indexOf("nw-4"));
  });

  it("root rows have kind='root' and depth=0", () => {
    const result = filterWorkspaces(allWorkspaces, rootMap, "", rootWorkspaces);
    const rootRows = result.filter((r) => r.kind === "root");

    expect(rootRows).toHaveLength(2);
    for (const row of rootRows) {
      expect(row.depth).toBe(0);
      expect(row.wsId).toBeDefined();
    }
  });

  it("branch rows under a Root have kind='branch' and depth=1", () => {
    const result = filterWorkspaces(allWorkspaces, rootMap, "", rootWorkspaces);
    const depth1Rows = result.filter(
      (r) => r.kind === "branch" && r.depth === 1,
    );

    // All four under-Root branches
    expect(depth1Rows).toHaveLength(4);
    expect(depth1Rows.map((r) => r.ws.id)).toEqual(
      expect.arrayContaining(["nw-1", "nw-2", "nw-3", "nw-4"]),
    );
  });

  it("standalone branch rows have depth=0", () => {
    const result = filterWorkspaces(allWorkspaces, rootMap, "", rootWorkspaces);
    const standaloneRow = result.find((r) => r.ws.id === "nw-5");

    expect(standaloneRow).toBeDefined();
    expect(standaloneRow!.depth).toBe(0);
    expect(standaloneRow!.kind).toBe("branch");
  });

  it("filter with Root name matches the root row and all its branches", () => {
    const result = filterWorkspaces(
      allWorkspaces,
      rootMap,
      "alpha",
      rootWorkspaces,
    );

    expect(result.some((r) => r.ws.id === "ws-a")).toBe(true);
    expect(result.some((r) => r.ws.id === "nw-1")).toBe(true);
    expect(result.some((r) => r.ws.id === "nw-2")).toBe(true);
    // Beta and its branches should not appear
    expect(result.some((r) => r.ws.id === "ws-b")).toBe(false);
    expect(result.some((r) => r.ws.id === "nw-3")).toBe(false);
  });

  it("filter with branch workspace name returns only that row and its Root", () => {
    const result = filterWorkspaces(
      allWorkspaces,
      rootMap,
      "hotfix",
      rootWorkspaces,
    );

    // hotfix-db is under Beta — root row should be included
    expect(result.some((r) => r.ws.id === "ws-b")).toBe(true);
    expect(result.some((r) => r.ws.id === "nw-3")).toBe(true);
    // Other Beta branches should NOT appear
    expect(result.some((r) => r.ws.id === "nw-4")).toBe(false);
    // Alpha and its branches should not appear
    expect(result.some((r) => r.ws.id === "ws-a")).toBe(false);
  });

  it("root row always precedes its matching branch rows after filtering", () => {
    const result = filterWorkspaces(
      allWorkspaces,
      rootMap,
      "feature",
      rootWorkspaces,
    );

    const ids = result.map((r) => r.ws.id);
    expect(ids.indexOf("ws-a")).toBeLessThan(ids.indexOf("nw-2"));
  });

  it("preserves original flat indices on branch rows", () => {
    // nw-3 is at index 2 in allWorkspaces
    const result = filterWorkspaces(
      allWorkspaces,
      rootMap,
      "hotfix",
      rootWorkspaces,
    );
    const row = result.find((r) => r.ws.id === "nw-3");

    expect(row).toBeDefined();
    expect(row!.idx).toBe(2);
  });

  it("root rows have idx=-1", () => {
    const result = filterWorkspaces(allWorkspaces, rootMap, "", rootWorkspaces);
    const rootRows = result.filter((r) => r.kind === "root");

    for (const row of rootRows) {
      expect(row.idx).toBe(-1);
    }
  });

  it("returns empty array when no match", () => {
    const result = filterWorkspaces(
      allWorkspaces,
      rootMap,
      "zzznomatch",
      rootWorkspaces,
    );
    expect(result).toHaveLength(0);
  });

  it("standalone branch row matches by name only", () => {
    const result = filterWorkspaces(
      allWorkspaces,
      rootMap,
      "standalone",
      rootWorkspaces,
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.ws.id).toBe("nw-5");
  });
});

// ---- Flat mode tests (backward compatibility: no rootWorkspaces param) ----

describe("filterWorkspaces — flat mode (no rootWorkspaces)", () => {
  const branches = [
    makeWs({ id: "nw-1", name: "main", rootWorkspaceId: "ws-a" }),
    makeWs({ id: "nw-2", name: "feature/login", rootWorkspaceId: "ws-a" }),
    makeWs({ id: "nw-3", name: "hotfix-db", rootWorkspaceId: "ws-b" }),
    makeWs({ id: "nw-4", name: "develop", rootWorkspaceId: "ws-b" }),
    makeWs({ id: "nw-5", name: "standalone" }),
  ];

  const flatRootMap = new Map<string, WorkspaceRecord>([
    ["ws-a", makeRoot("ws-a", "Alpha Root")],
    ["ws-b", makeRoot("ws-b", "Beta Corp")],
  ]);

  it("returns all workspaces when query is empty", () => {
    const result = filterWorkspaces(branches, flatRootMap, "");
    expect(result).toHaveLength(branches.length);
    expect(result.map((r) => r.ws.id)).toEqual(branches.map((w) => w.id));
  });

  it("returns all workspaces when query is whitespace-only", () => {
    const result = filterWorkspaces(branches, flatRootMap, "   ");
    expect(result).toHaveLength(branches.length);
  });

  it("filters on branch name (case-insensitive)", () => {
    const result = filterWorkspaces(branches, flatRootMap, "FEATURE");
    expect(result).toHaveLength(1);
    expect(result[0]!.ws.id).toBe("nw-2");
  });

  it("filters on Workspace name", () => {
    const result = filterWorkspaces(branches, flatRootMap, "alpha");
    // "Alpha Root" matches nw-1 and nw-2
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.ws.id)).toContain("nw-1");
    expect(result.map((r) => r.ws.id)).toContain("nw-2");
  });

  it("is case-insensitive on Root name", () => {
    const lower = filterWorkspaces(branches, flatRootMap, "beta");
    const upper = filterWorkspaces(branches, flatRootMap, "BETA");
    expect(lower).toHaveLength(upper.length);
    expect(lower.map((r) => r.ws.id)).toEqual(upper.map((r) => r.ws.id));
  });

  it("preserves original indices for switchWorkspace", () => {
    const result = filterWorkspaces(branches, flatRootMap, "hotfix");
    expect(result).toHaveLength(1);
    expect(result[0]!.idx).toBe(2); // "hotfix-db" is at index 2
  });

  it("returns empty array when no match", () => {
    const result = filterWorkspaces(branches, flatRootMap, "zzznomatch");
    expect(result).toHaveLength(0);
  });

  it("handles workspaces with no Root gracefully", () => {
    const result = filterWorkspaces(branches, flatRootMap, "standalone");
    expect(result).toHaveLength(1);
    expect(result[0]!.rootLabel).toBe("");
  });

  it("attaches rootLabel correctly", () => {
    const result = filterWorkspaces(branches, flatRootMap, "develop");
    expect(result).toHaveLength(1);
    expect(result[0]!.rootLabel).toBe("Beta Corp");
  });

  it("all flat rows have kind='branch' and depth=0", () => {
    const result = filterWorkspaces(branches, flatRootMap, "");
    for (const row of result) {
      expect(row.kind).toBe("branch");
      expect(row.depth).toBe(0);
    }
  });
});
