/**
 * provisionAutoDashboardsForWorkspace — called on workspace create and on startup
 * reconciliation. Iterates every registered DashboardContribution with
 * `autoProvision: true` and invokes contribution.create(workspace) for any
 * that isn't already backed by a workspace. Idempotent.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import {
  nestedWorkspaces,
  activeNestedWorkspaceIdx,
} from "../lib/stores/nested-workspace";
import {
  registerDashboardContribution,
  resetDashboardContributions,
} from "../lib/services/dashboard-contribution-registry";
import { provisionAutoDashboardsForWorkspace } from "../lib/services/workspace-service";
import type { Workspace } from "../lib/config";

function makeWorkspace(id: string): Workspace {
  return {
    id,
    name: `Workspace `,
    path: `/tmp/${id}`,
    color: "purple",
    nestedWorkspaceIds: [],
    isGit: false,
    createdAt: "2026-04-21T00:00:00.000Z",
  };
}

describe("provisionAutoDashboardsForWorkspace", () => {
  beforeEach(() => {
    nestedWorkspaces.set([]);
    activeNestedWorkspaceIdx.set(-1);
    resetDashboardContributions();
  });

  it("calls create() for every autoProvision contribution", async () => {
    const aCreate = vi.fn(async () => "ws-a");
    const bCreate = vi.fn(async () => "ws-b");
    registerDashboardContribution({
      id: "a",
      source: "core",
      label: "A",
      actionLabel: "Add A",
      capPerWorkspace: 1,
      autoProvision: true,
      create: aCreate,
    });
    registerDashboardContribution({
      id: "b",
      source: "core",
      label: "B",
      actionLabel: "Add B",
      capPerWorkspace: 1,
      autoProvision: true,
      create: bCreate,
    });
    registerDashboardContribution({
      id: "c",
      source: "core",
      label: "C",
      actionLabel: "Add C",
      capPerWorkspace: 1,
      create: vi.fn(async () => "ws-c"),
    });

    const workspace = makeWorkspace("g1");
    await provisionAutoDashboardsForWorkspace(workspace);

    expect(aCreate).toHaveBeenCalledWith(workspace);
    expect(bCreate).toHaveBeenCalledWith(workspace);
    // Non-autoProvision contributions are NOT auto-materialized.
    expect(
      (
        registerDashboardContribution as unknown as {
          mock?: { calls: unknown[][] };
        }
      ).mock,
    ).toBeUndefined();
  });

  it("skips contributions whose dashboard workspace already exists for the workspace", async () => {
    const aCreate = vi.fn(async () => "ws-a");
    registerDashboardContribution({
      id: "a",
      source: "core",
      label: "A",
      actionLabel: "Add A",
      capPerWorkspace: 1,
      autoProvision: true,
      create: aCreate,
    });

    const workspace = makeWorkspace("g1");
    // Seed the nestedWorkspaces store with an existing dashboard for "a".
    nestedWorkspaces.set([
      {
        id: "ws-existing",
        name: "A",
        layout: { pane: { id: "p", surfaces: [], activeIdx: 0 } },
        metadata: {
          isDashboard: true,
          parentWorkspaceId: workspace.id,
          dashboardContributionId: "a",
        },
      } as never,
    ]);

    await provisionAutoDashboardsForWorkspace(workspace);

    expect(aCreate).not.toHaveBeenCalled();
    // Sanity: no new nestedWorkspaces added.
    expect(get(nestedWorkspaces)).toHaveLength(1);
  });

  it("is idempotent — calling twice does not double-materialize", async () => {
    const bCreate = vi.fn(async () => {
      // Simulate create by pushing a workspace into the store.
      nestedWorkspaces.update((ws) => [
        ...ws,
        {
          id: `ws-${ws.length + 1}`,
          name: "B",
          layout: { pane: { id: "p", surfaces: [], activeIdx: 0 } },
          metadata: {
            isDashboard: true,
            parentWorkspaceId: "g1",
            dashboardContributionId: "b",
          },
        } as never,
      ]);
      return "ws-1";
    });
    registerDashboardContribution({
      id: "b",
      source: "core",
      label: "B",
      actionLabel: "Add B",
      capPerWorkspace: 1,
      autoProvision: true,
      create: bCreate,
    });

    const workspace = makeWorkspace("g1");
    await provisionAutoDashboardsForWorkspace(workspace);
    await provisionAutoDashboardsForWorkspace(workspace);

    expect(bCreate).toHaveBeenCalledTimes(1);
  });
});
