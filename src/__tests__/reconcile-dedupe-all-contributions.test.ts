/**
 * reconcileWorkspaceDashboards must deduplicate ALL autoProvision contribution
 * types (settings, agentic, …), not just "group". Duplicates arise from a
 * startup race where a provision loop creates fresh dashboards after
 * workspaces.set([]) clears the store but before restoreWorkspaces finishes.
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

import { reconcileWorkspaceDashboards } from "../lib/services/workspace-service";
import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import {
  registerDashboardContribution,
  resetDashboardContributions,
} from "../lib/services/dashboard-contribution-registry";

const WORKSPACE = {
  id: "g1",
  name: "TestWorkspace",
  path: "/tmp/workspace1",
  color: "blue",
  branchedWorkspaceIds: [],
  isGit: false,
  createdAt: "2026-04-21T00:00:00.000Z",
  splitRoot: {
    type: "pane",
    pane: { id: "wp", surfaces: [], activeSurfaceId: null },
  },
  activePaneId: "wp",
} as never;

function makeDashboard(id: string, contribId: string): never {
  return {
    id,
    name: contribId,
    splitRoot: {
      type: "pane",
      pane: { id: "p", surfaces: [], activeSurfaceId: null },
    },
    activePaneId: "p",
    isDashboard: true,
    rootWorkspaceId: WORKSPACE.id,
    dashboardContributionId: contribId,
  } as never;
}

describe("reconcileWorkspaceDashboards — dedupe all contribution types", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async () => undefined);
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    resetDashboardContributions();
  });

  it("removes a duplicate 'settings' dashboard, keeping exactly one", async () => {
    registerDashboardContribution({
      id: "settings",
      source: "core",
      label: "Settings",
      actionLabel: "Add Settings",
      capPerWorkspace: 1,
      autoProvision: true,
      create: vi.fn(async () => "ws-new"),
    });
    workspaces.set([
      WORKSPACE,
      makeDashboard("settings-1", "settings"),
      makeDashboard("settings-2", "settings"),
    ]);

    await reconcileWorkspaceDashboards();

    const remaining = get(workspaces).filter((w) => {
      return (
        w.dashboardContributionId === "settings" &&
        w.rootWorkspaceId === WORKSPACE.id
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
      capPerWorkspace: 1,
      autoProvision: true,
      create: vi.fn(async () => "ws-new"),
    });
    workspaces.set([
      WORKSPACE,
      makeDashboard("agentic-1", "agentic"),
      makeDashboard("agentic-2", "agentic"),
    ]);

    await reconcileWorkspaceDashboards();

    const remaining = get(workspaces).filter((w) => {
      return (
        w.dashboardContributionId === "agentic" &&
        w.rootWorkspaceId === WORKSPACE.id
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
        capPerWorkspace: 1,
        autoProvision: true,
        create: vi.fn(async () => "ws-new"),
      });
    }
    workspaces.set([
      WORKSPACE,
      makeDashboard("group-1", "group"),
      makeDashboard("group-2", "group"),
      makeDashboard("settings-1", "settings"),
      makeDashboard("settings-2", "settings"),
      makeDashboard("agentic-1", "agentic"),
      makeDashboard("agentic-2", "agentic"),
    ]);

    await reconcileWorkspaceDashboards();

    const all = get(workspaces);
    for (const contribId of ["group", "settings", "agentic"]) {
      const matches = all.filter((w) => {
        return (
          w.dashboardContributionId === contribId &&
          w.rootWorkspaceId === WORKSPACE.id
        );
      });
      expect(
        matches,
        `expected exactly 1 "${contribId}" dashboard`,
      ).toHaveLength(1);
    }
  });
});
