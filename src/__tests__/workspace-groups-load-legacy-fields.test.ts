/**
 * Regression test: loadWorkspaces() must rewrite legacy
 * `primaryWorkspaceId`/`dashboardWorkspaceId` field names on persisted
 * workspace records to the new `primaryNestedWorkspaceId`/
 * `dashboardNestedWorkspaceId` shape so consumers see only the renamed
 * fields after read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

const stateMock = vi.hoisted(() => ({
  loaded: {} as Record<string, unknown>,
}));

vi.mock("../lib/services/extension-state", () => ({
  loadExtensionState: vi.fn(async () => stateMock.loaded),
  saveExtensionState: vi.fn(async () => {}),
}));

import {
  loadWorkspaces,
  workspacesStore,
  resetWorkspacesForTest,
} from "../lib/stores/workspaces";

beforeEach(() => {
  resetWorkspacesForTest();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("loadWorkspaces — legacy field rename", () => {
  it("promotes legacy primaryWorkspaceId/dashboardWorkspaceId to renamed fields", async () => {
    stateMock.loaded = {
      workspaces: [
        {
          id: "g-1",
          name: "Old",
          path: "/x",
          color: "blue",
          isGit: false,
          createdAt: "2026-01-01",
          workspaceIds: ["ws-stale"], // ignored — rebuilt on demand
          primaryWorkspaceId: "ws-primary",
          dashboardWorkspaceId: "ws-dash",
        },
      ],
    };

    await loadWorkspaces();

    const groups = get(workspacesStore);
    expect(groups).toHaveLength(1);
    const g = groups[0] as Record<string, unknown>;
    expect(g.primaryNestedWorkspaceId).toBe("ws-primary");
    expect(g.dashboardNestedWorkspaceId).toBe("ws-dash");
    expect(g.primaryWorkspaceId).toBeUndefined();
    expect(g.dashboardWorkspaceId).toBeUndefined();
    // nestedWorkspaceIds is always reset to [] (rebuilt at runtime)
    expect(g.nestedWorkspaceIds).toEqual([]);
  });

  it("passes through already-renamed fields untouched", async () => {
    stateMock.loaded = {
      workspaces: [
        {
          id: "g-1",
          name: "New",
          path: "/x",
          color: "blue",
          isGit: false,
          createdAt: "2026-01-01",
          nestedWorkspaceIds: [],
          primaryNestedWorkspaceId: "ws-p",
          dashboardNestedWorkspaceId: "ws-d",
        },
      ],
    };

    await loadWorkspaces();

    const g = get(workspacesStore)[0] as Record<string, unknown>;
    expect(g.primaryNestedWorkspaceId).toBe("ws-p");
    expect(g.dashboardNestedWorkspaceId).toBe("ws-d");
  });

  it("prefers new field over legacy when both are present", async () => {
    stateMock.loaded = {
      workspaces: [
        {
          id: "g-1",
          name: "Both",
          path: "/x",
          color: "blue",
          isGit: false,
          createdAt: "2026-01-01",
          primaryWorkspaceId: "stale",
          primaryNestedWorkspaceId: "fresh",
        },
      ],
    };

    await loadWorkspaces();
    const g = get(workspacesStore)[0] as Record<string, unknown>;
    expect(g.primaryNestedWorkspaceId).toBe("fresh");
    expect(g.primaryWorkspaceId).toBeUndefined();
  });
});
