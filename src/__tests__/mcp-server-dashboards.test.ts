/**
 * MCP dashboard contribution tools:
 *   - list_dashboard_contributions
 *   - add_dashboard_to_workspace
 *   - remove_dashboard_from_workspace
 *
 * Dashboards live as tabs inside the root workspace's pane tree (not as
 * separate workspaces). `add_dashboard_to_workspace` invokes the
 * contribution's `openAsTab` hook; `remove_dashboard_from_workspace`
 * closes any matching tab. `active` annotation reflects live tab presence
 * (a registry surface stamped with `dashboardContributionId`).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
  emit: vi.fn().mockResolvedValue(undefined),
}));

import { dispatch, _resetMcpServerForTest } from "../lib/services/mcp-server";
import {
  registerDashboardContribution,
  resetDashboardContributions,
} from "../lib/services/dashboard-contribution-registry";
import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";

function rpc(method: string, params?: unknown, id: number = 1) {
  return { jsonrpc: "2.0" as const, id, method, params };
}

function seedWorkspace(id: string) {
  workspaces.update((cur) => [
    ...cur,
    {
      id,
      name: `Workspace ${id}`,
      path: `/tmp/${id}`,
      color: "purple",
      branchedWorkspaceIds: [],
      isGit: false,
      createdAt: "2026-04-21T00:00:00.000Z",
      paneLayout: {
        type: "pane",
        pane: { id: `${id}-p`, surfaces: [], activeSurfaceId: null },
      },
      activePaneId: `${id}-p`,
    } as never,
  ]);
}

/**
 * Stamp a registry surface tagged with `dashboardContributionId` directly
 * onto the workspace's primary pane so `isDashboardContributionTabActive`
 * reports the contribution as active without going through openAsTab.
 */
function seedDashboardTab(rootWorkspaceId: string, contributionId: string) {
  workspaces.update((cur) =>
    cur.map((w) =>
      w.id === rootWorkspaceId
        ? ({
            ...w,
            paneLayout: {
              type: "pane",
              pane: {
                id: `${rootWorkspaceId}-p`,
                surfaces: [
                  {
                    id: `s-${contributionId}`,
                    kind: "registry",
                    surfaceTypeId: `tab-${contributionId}`,
                    title: contributionId,
                    props: {},
                    matchProps: {},
                    dashboardContributionId: contributionId,
                  },
                ],
                activeSurfaceId: `s-${contributionId}`,
              },
            },
          } as never)
        : w,
    ),
  );
}

describe("MCP dashboard contribution tools", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    _resetMcpServerForTest();
    resetDashboardContributions();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
  });

  describe("list_dashboard_contributions", () => {
    it("returns every registered contribution with metadata", async () => {
      registerDashboardContribution({
        id: "overview",
        source: "core",
        label: "Overview",
        actionLabel: "Add Overview",
        capPerWorkspace: 1,
        autoProvision: true,
        lockedReason: "Required",
        openAsTab: vi.fn(async () => {}),
      });
      registerDashboardContribution({
        id: "diff",
        source: "diff-viewer",
        label: "Diff",
        actionLabel: "Add Diff Dashboard",
        capPerWorkspace: 1,
        openAsTab: vi.fn(async () => {}),
      });

      const resp = await dispatch(
        rpc("tools/call", {
          name: "list_dashboard_contributions",
          arguments: {},
        }),
      );
      const rows = (resp as any).result.structuredContent
        .contributions as Array<{
        id: string;
        source: string;
        auto_provision: boolean;
        locked_reason?: string;
      }>;
      expect(rows).toHaveLength(2);
      const overview = rows.find((r) => r.id === "overview");
      const diff = rows.find((r) => r.id === "diff");
      expect(overview?.auto_provision).toBe(true);
      expect(overview?.locked_reason).toBe("Required");
      expect(diff?.auto_provision).toBe(false);
    });

    it("annotates active state when workspace_id is provided", async () => {
      seedWorkspace("g1");
      registerDashboardContribution({
        id: "diff",
        source: "diff-viewer",
        label: "Diff",
        actionLabel: "Add Diff",
        capPerWorkspace: 1,
        openAsTab: vi.fn(async () => {}),
      });
      // Tab presence drives `active` — stamp a registry surface with the
      // matching contribution id onto the workspace's pane.
      seedDashboardTab("g1", "diff");

      const resp = await dispatch(
        rpc("tools/call", {
          name: "list_dashboard_contributions",
          arguments: { workspace_id: "g1" },
        }),
      );
      const rows = (resp as any).result.structuredContent
        .contributions as Array<{
        id: string;
        active: boolean;
      }>;
      const diff = rows.find((r) => r.id === "diff");
      expect(diff?.active).toBe(true);
    });
  });

  describe("add_dashboard_to_workspace", () => {
    it("invokes contribution.openAsTab and returns added=true", async () => {
      seedWorkspace("g1");
      const openAsTab = vi.fn(async () => {});
      registerDashboardContribution({
        id: "diff",
        source: "diff-viewer",
        label: "Diff",
        actionLabel: "Add Diff",
        capPerWorkspace: 1,
        openAsTab,
      });

      const resp = await dispatch(
        rpc("tools/call", {
          name: "add_dashboard_to_workspace",
          arguments: { workspace_id: "g1", contribution_id: "diff" },
        }),
      );
      expect((resp as any).result.structuredContent.added).toBe(true);
      expect(openAsTab).toHaveBeenCalledTimes(1);
    });

    it("rejects an autoProvision contribution", async () => {
      seedWorkspace("g1");
      registerDashboardContribution({
        id: "agentic",
        source: "agentic-orchestrator",
        label: "Agentic",
        actionLabel: "Add Agentic",
        capPerWorkspace: 1,
        autoProvision: true,
        openAsTab: vi.fn(async () => {}),
      });

      const resp = await dispatch(
        rpc("tools/call", {
          name: "add_dashboard_to_workspace",
          arguments: { workspace_id: "g1", contribution_id: "agentic" },
        }),
      );
      expect((resp as any).error).toBeDefined();
    });

    it("rejects an unknown workspace or contribution", async () => {
      registerDashboardContribution({
        id: "diff",
        source: "diff-viewer",
        label: "Diff",
        actionLabel: "Add Diff",
        capPerWorkspace: 1,
        openAsTab: vi.fn(async () => {}),
      });

      const respWorkspace = await dispatch(
        rpc("tools/call", {
          name: "add_dashboard_to_workspace",
          arguments: { workspace_id: "nope", contribution_id: "diff" },
        }),
      );
      expect((respWorkspace as any).error).toBeDefined();

      seedWorkspace("g1");
      const respContrib = await dispatch(
        rpc("tools/call", {
          name: "add_dashboard_to_workspace",
          arguments: { workspace_id: "g1", contribution_id: "ghost" },
        }),
      );
      expect((respContrib as any).error).toBeDefined();
    });
  });

  describe("remove_dashboard_from_workspace", () => {
    it("returns removed=false when no tab exists for the pair", async () => {
      seedWorkspace("g1");
      registerDashboardContribution({
        id: "diff",
        source: "diff-viewer",
        label: "Diff",
        actionLabel: "Add Diff",
        capPerWorkspace: 1,
        openAsTab: vi.fn(async () => {}),
      });

      const resp = await dispatch(
        rpc("tools/call", {
          name: "remove_dashboard_from_workspace",
          arguments: { workspace_id: "g1", contribution_id: "diff" },
        }),
      );
      expect((resp as any).result.structuredContent.removed).toBe(false);
    });

    it("rejects an autoProvision contribution", async () => {
      seedWorkspace("g1");
      registerDashboardContribution({
        id: "agentic",
        source: "agentic-orchestrator",
        label: "Agentic",
        actionLabel: "Add Agentic",
        capPerWorkspace: 1,
        autoProvision: true,
        openAsTab: vi.fn(async () => {}),
      });

      const resp = await dispatch(
        rpc("tools/call", {
          name: "remove_dashboard_from_workspace",
          arguments: { workspace_id: "g1", contribution_id: "agentic" },
        }),
      );
      expect((resp as any).error).toBeDefined();
    });
  });
});
