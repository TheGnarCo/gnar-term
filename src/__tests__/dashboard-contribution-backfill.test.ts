/**
 * Legacy dashboard workspaces (created before
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
import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import { workspacesStore } from "../lib/stores/workspace";

const WORKSPACE = {
  id: "g1",
  name: "Repo",
  path: "/tmp/repo",
  color: "purple",
  branchedWorkspaceIds: ["ws-legacy-overview", "ws-legacy-agentic"],
  isGit: false,
  createdAt: "2026-04-21T00:00:00.000Z",
  dashboardWorkspaceId: "ws-legacy-overview",
};

describe("dashboardContributionId backfill", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    // No file writes during reconcile — stay on happy paths.
    invokeMock.mockImplementation(async () => undefined);
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    workspacesStore.set([WORKSPACE]);
  });

  it("stamps 'group' on a legacy Overview dashboard (preview → project-dashboard.md)", async () => {
    workspaces.set([
      {
        id: "ws-legacy-overview",
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
        isDashboard: true,
        parentWorkspaceId: "g1",
      } as never,
    ]);

    await reconcileWorkspaceDashboards();

    expect(get(workspaces)[0]!.dashboardContributionId).toBe("group");
  });

  it("leaves already-stamped workspaces alone", async () => {
    workspaces.set([
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
        isDashboard: true,
        parentWorkspaceId: "g1",
        dashboardContributionId: "group",
      } as never,
    ]);

    await reconcileWorkspaceDashboards();

    expect(get(workspaces)[0]!.dashboardContributionId).toBe("group");
  });
});
