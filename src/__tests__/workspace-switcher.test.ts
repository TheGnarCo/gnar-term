import { describe, it, expect } from "vitest";
import { filterWorkspaces } from "../lib/services/workspace-switcher-filter";
import type { Workspace } from "../lib/types";
import type { WorkspaceRecord } from "../lib/config";

// ---- Minimal stubs ----

function makeWs(
  overrides: Partial<Workspace> & {
    id: string;
    name: string;
    parentWorkspaceId?: string;
  },
): Workspace {
  return {
    splitRoot: {
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

// ---- Setup ----

const parentA = makeParent("ws-a", "Alpha Project");
const parentB = makeParent("ws-b", "Beta Corp");

const branches = [
  makeWs({ id: "nw-1", name: "main", parentWorkspaceId: "ws-a" }),
  makeWs({ id: "nw-2", name: "feature/login", parentWorkspaceId: "ws-a" }),
  makeWs({ id: "nw-3", name: "hotfix-db", parentWorkspaceId: "ws-b" }),
  makeWs({ id: "nw-4", name: "develop", parentWorkspaceId: "ws-b" }),
  makeWs({ id: "nw-5", name: "standalone" }), // no parent
];

const parentMap = new Map<string, WorkspaceRecord>([
  ["ws-a", parentA],
  ["ws-b", parentB],
]);

// ---- Tests ----

describe("filterWorkspaces", () => {
  it("returns all workspaces when query is empty", () => {
    const result = filterWorkspaces(branches, parentMap, "");
    expect(result).toHaveLength(branches.length);
    expect(result.map((r) => r.ws.id)).toEqual(branches.map((w) => w.id));
  });

  it("returns all workspaces when query is whitespace-only", () => {
    const result = filterWorkspaces(branches, parentMap, "   ");
    expect(result).toHaveLength(branches.length);
  });

  it("filters on branch name (case-insensitive)", () => {
    const result = filterWorkspaces(branches, parentMap, "FEATURE");
    expect(result).toHaveLength(1);
    expect(result[0]!.ws.id).toBe("nw-2");
  });

  it("filters on parent workspace name", () => {
    const result = filterWorkspaces(branches, parentMap, "alpha");
    // "Alpha Project" matches nw-1 and nw-2
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.ws.id)).toContain("nw-1");
    expect(result.map((r) => r.ws.id)).toContain("nw-2");
  });

  it("is case-insensitive on parent name", () => {
    const lower = filterWorkspaces(branches, parentMap, "beta");
    const upper = filterWorkspaces(branches, parentMap, "BETA");
    expect(lower).toHaveLength(upper.length);
    expect(lower.map((r) => r.ws.id)).toEqual(upper.map((r) => r.ws.id));
  });

  it("preserves original indices for switchWorkspace", () => {
    const result = filterWorkspaces(branches, parentMap, "hotfix");
    expect(result).toHaveLength(1);
    expect(result[0]!.idx).toBe(2); // "hotfix-db" is at index 2
  });

  it("returns empty array when no match", () => {
    const result = filterWorkspaces(branches, parentMap, "zzznomatch");
    expect(result).toHaveLength(0);
  });

  it("handles workspaces with no parent gracefully", () => {
    const result = filterWorkspaces(branches, parentMap, "standalone");
    expect(result).toHaveLength(1);
    expect(result[0]!.parentLabel).toBe("");
  });

  it("attaches parentLabel correctly", () => {
    const result = filterWorkspaces(branches, parentMap, "develop");
    expect(result).toHaveLength(1);
    expect(result[0]!.parentLabel).toBe("Beta Corp");
  });
});
