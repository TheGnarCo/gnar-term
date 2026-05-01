/**
 * reconcileWorkspaceDashboards must deduplicate ALL autoProvision contribution
 * types (settings, agentic, …), not just "group". Duplicates arise from a
 * startup race where a provision loop creates fresh dashboards after
 * nestedWorkspaces.set([]) clears the store but before restoreWorkspaces finishes.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import { reconcileWorkspaceDashboards } from "../lib/services/workspace-group-service";
import {
  nestedWorkspaces,
  activeNestedWorkspaceIdx,
} from "../lib/stores/workspace";
import { workspacesStore } from "../lib/stores/workspace-groups";
import {
  registerDashboardContribution,
  resetDashboardContributions,
} from "../lib/services/dashboard-contribution-registry";

const GROUP = {
  id: "g1",
  name: "TestGroup",
  path: "/tmp/group1",
  color: "blue",
  workspaceIds: [],
  isGit: false,
  createdAt: "2026-04-21T00:00:00.000Z",
};

function makeDashboard(id: string, contribId: string): never {
  return {
    id,
    name: contribId,
    splitRoot: {
      type: "pane",
      pane: { id: "p", surfaces: [], activeSurfaceId: null },
    },
    activePaneId: "p",
    metadata: {
      isDashboard: true,
      parentWorkspaceId: GROUP.id,
      dashboardContributionId: contribId,
    },
  } as never;
}

describe("reconcileWorkspaceDashboards — dedupe all contribution types", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async () => undefined);
    nestedWorkspaces.set([]);
    activeNestedWorkspaceIdx.set(-1);
    workspacesStore.set([GROUP]);
    resetDashboardContributions();
  });

  it("removes a duplicate 'settings' dashboard, keeping exactly one", async () => {
    registerDashboardContribution({
      id: "settings",
      source: "core",
      label: "Settings",
      actionLabel: "Add Settings",
      capPerGroup: 1,
      autoProvision: true,
      create: vi.fn(async () => "ws-new"),
    });
    nestedWorkspaces.set([
      makeDashboard("settings-1", "settings"),
      makeDashboard("settings-2", "settings"),
    ]);

    await reconcileWorkspaceDashboards();

    const remaining = get(nestedWorkspaces).filter((w) => {
      return (
        w.metadata?.dashboardContributionId === "settings" &&
        w.metadata?.parentWorkspaceId === GROUP.id
      );
    });
    expect(remaining).toHaveLength(1);
  });

  it("removes a duplicate 'agentic' dashboard, keeping exactly one", async () => {
    registerDashboardContribution({
      id: "agentic",
      source: "ext",
      label: "Agentic",
      actionLabel: "Add Agentic",
      capPerGroup: 1,
      autoProvision: true,
      create: vi.fn(async () => "ws-new"),
    });
    nestedWorkspaces.set([
      makeDashboard("agentic-1", "agentic"),
      makeDashboard("agentic-2", "agentic"),
    ]);

    await reconcileWorkspaceDashboards();

    const remaining = get(nestedWorkspaces).filter((w) => {
      return (
        w.metadata?.dashboardContributionId === "agentic" &&
        w.metadata?.parentWorkspaceId === GROUP.id
      );
    });
    expect(remaining).toHaveLength(1);
  });

  it("deduplicates all contribution types in a single reconcile pass", async () => {
    for (const [id, source] of [
      ["group", "core"],
      ["settings", "core"],
      ["agentic", "ext"],
    ] as const) {
      registerDashboardContribution({
        id,
        source,
        label: id,
        actionLabel: `Add ${id}`,
        capPerGroup: 1,
        autoProvision: true,
        create: vi.fn(async () => "ws-new"),
      });
    }
    nestedWorkspaces.set([
      makeDashboard("group-1", "group"),
      makeDashboard("group-2", "group"),
      makeDashboard("settings-1", "settings"),
      makeDashboard("settings-2", "settings"),
      makeDashboard("agentic-1", "agentic"),
      makeDashboard("agentic-2", "agentic"),
    ]);

    await reconcileWorkspaceDashboards();

    const all = get(nestedWorkspaces);
    for (const contribId of ["group", "settings", "agentic"]) {
      const matches = all.filter((w) => {
        return (
          w.metadata?.dashboardContributionId === contribId &&
          w.metadata?.parentWorkspaceId === GROUP.id
        );
      });
      expect(
        matches,
        `expected exactly 1 "${contribId}" dashboard`,
      ).toHaveLength(1);
    }
  });
});
