/**
 * Legacy dashboard nestedWorkspaces (created before
 * `metadata.dashboardContributionId` existed) get their contribId
 * backfilled on reconcile by inspecting the preview surface's backing
 * path. Without this, autoProvision's strict contribId match would
 * spawn a duplicate every startup.
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
import {
  nestedWorkspaces,
  activeNestedWorkspaceIdx,
} from "../lib/stores/nested-workspace";
import { workspacesStore } from "../lib/stores/workspaces";

const GROUP = {
  id: "g1",
  name: "Repo",
  path: "/tmp/repo",
  color: "purple",
  nestedWorkspaceIds: ["ws-legacy-group", "ws-legacy-agentic"],
  isGit: false,
  createdAt: "2026-04-21T00:00:00.000Z",
  dashboardNestedWorkspaceId: "ws-legacy-group",
};

describe("dashboardContributionId backfill", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    // No file writes during reconcile — stay on happy paths.
    invokeMock.mockImplementation(async () => undefined);
    nestedWorkspaces.set([]);
    activeNestedWorkspaceIdx.set(-1);
    workspacesStore.set([GROUP]);
  });

  it("stamps 'group' on a legacy Overview dashboard (preview → project-dashboard.md)", async () => {
    nestedWorkspaces.set([
      {
        id: "ws-legacy-group",
        name: "Dashboard",
        splitRoot: {
          type: "pane",
          pane: {
            id: "p1",
            surfaces: [
              {
                kind: "preview",
                id: "s1",
                title: "Dashboard",
                path: "/tmp/repo/.gnar-term/project-dashboard.md",
                hasUnread: false,
              },
            ],
            activeSurfaceId: "s1",
          },
        },
        activePaneId: "p1",
        metadata: { isDashboard: true, parentWorkspaceId: "g1" },
      } as never,
    ]);

    await reconcileWorkspaceDashboards();

    const md = get(nestedWorkspaces)[0]!.metadata;
    expect(md.dashboardContributionId).toBe("group");
  });

  it("stamps 'agentic' on a legacy Agentic dashboard (preview → agentic-dashboard.md)", async () => {
    nestedWorkspaces.set([
      {
        id: "ws-legacy-agentic",
        name: "Agents",
        splitRoot: {
          type: "pane",
          pane: {
            id: "p2",
            surfaces: [
              {
                kind: "preview",
                id: "s2",
                title: "Agents",
                path: "/tmp/repo/.gnar-term/agentic-dashboard.md",
                hasUnread: false,
              },
            ],
            activeSurfaceId: "s2",
          },
        },
        activePaneId: "p2",
        metadata: { isDashboard: true, parentWorkspaceId: "g1" },
      } as never,
    ]);

    await reconcileWorkspaceDashboards();

    const md = get(nestedWorkspaces)[0]!.metadata;
    expect(md.dashboardContributionId).toBe("agentic");
  });

  it("leaves already-stamped nestedWorkspaces alone", async () => {
    nestedWorkspaces.set([
      {
        id: "ws-stamped",
        name: "Dashboard",
        splitRoot: {
          type: "pane",
          pane: {
            id: "p3",
            surfaces: [
              {
                kind: "preview",
                id: "s3",
                title: "Dashboard",
                path: "/tmp/repo/.gnar-term/project-dashboard.md",
                hasUnread: false,
              },
            ],
            activeSurfaceId: "s3",
          },
        },
        activePaneId: "p3",
        metadata: {
          isDashboard: true,
          parentWorkspaceId: "g1",
          dashboardContributionId: "group",
        },
      } as never,
    ]);

    await reconcileWorkspaceDashboards();

    const md = get(nestedWorkspaces)[0]!.metadata;
    expect(md.dashboardContributionId).toBe("group");
  });
});
