/**
 * MCP dashboard contribution tools:
 *   - list_dashboard_contributions
 *   - add_dashboard_to_group
 *   - remove_dashboard_from_group
 *
 * The first mirrors the in-app Settings dashboard's toggle list; the
 * second/third drive the same toggle interaction from an agent.
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
import {
  nestedWorkspaces,
  activeNestedWorkspaceIdx,
} from "../lib/stores/workspace";
import { workspacesStore } from "../lib/stores/workspace-groups";

function rpc(method: string, params?: unknown, id: number = 1) {
  return { jsonrpc: "2.0" as const, id, method, params };
}

function seedGroup(id: string) {
  workspacesStore.set([
    {
      id,
      name: `Group ${id}`,
      path: `/tmp/${id}`,
      color: "purple",
      nestedWorkspaceIds: [],
      isGit: false,
      createdAt: "2026-04-21T00:00:00.000Z",
    },
  ]);
}

describe("MCP dashboard contribution tools", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    _resetMcpServerForTest();
    resetDashboardContributions();
    nestedWorkspaces.set([]);
    activeNestedWorkspaceIdx.set(-1);
    workspacesStore.set([]);
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
        create: vi.fn(async () => "ws-ov"),
      });
      registerDashboardContribution({
        id: "diff",
        source: "diff-viewer",
        label: "Diff",
        actionLabel: "Add Diff Dashboard",
        capPerWorkspace: 1,
        create: vi.fn(async () => "ws-diff"),
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

    it("annotates active state when group_id is provided", async () => {
      seedGroup("g1");
      registerDashboardContribution({
        id: "diff",
        source: "diff-viewer",
        label: "Diff",
        actionLabel: "Add Diff",
        capPerWorkspace: 1,
        create: vi.fn(async () => "ws-diff"),
      });
      // Seed an active dashboard workspace for this contribution.
      nestedWorkspaces.set([
        {
          id: "ws-abc",
          name: "Diff",
          layout: { pane: { id: "p", surfaces: [], activeIdx: 0 } },
          metadata: {
            isDashboard: true,
            parentWorkspaceId: "g1",
            dashboardContributionId: "diff",
          },
        } as never,
      ]);

      const resp = await dispatch(
        rpc("tools/call", {
          name: "list_dashboard_contributions",
          arguments: { group_id: "g1" },
        }),
      );
      const rows = (resp as any).result.structuredContent
        .contributions as Array<{
        id: string;
        active: boolean;
        workspace_id?: string;
      }>;
      const diff = rows.find((r) => r.id === "diff");
      expect(diff?.active).toBe(true);
      expect(diff?.workspace_id).toBe("ws-abc");
    });
  });

  describe("add_dashboard_to_group", () => {
    it("invokes contribution.create and returns the new workspace id", async () => {
      seedGroup("g1");
      const create = vi.fn(async () => "ws-new");
      registerDashboardContribution({
        id: "diff",
        source: "diff-viewer",
        label: "Diff",
        actionLabel: "Add Diff",
        capPerWorkspace: 1,
        create,
      });

      const resp = await dispatch(
        rpc("tools/call", {
          name: "add_dashboard_to_group",
          arguments: { group_id: "g1", contribution_id: "diff" },
        }),
      );
      expect((resp as any).result.structuredContent.workspace_id).toBe(
        "ws-new",
      );
      expect(create).toHaveBeenCalledTimes(1);
    });

    it("rejects an autoProvision contribution", async () => {
      seedGroup("g1");
      registerDashboardContribution({
        id: "agentic",
        source: "agentic-orchestrator",
        label: "Agentic",
        actionLabel: "Add Agentic",
        capPerWorkspace: 1,
        autoProvision: true,
        create: vi.fn(async () => "ws-never"),
      });

      const resp = await dispatch(
        rpc("tools/call", {
          name: "add_dashboard_to_group",
          arguments: { group_id: "g1", contribution_id: "agentic" },
        }),
      );
      expect((resp as any).error).toBeDefined();
    });

    it("rejects an unknown group or contribution", async () => {
      registerDashboardContribution({
        id: "diff",
        source: "diff-viewer",
        label: "Diff",
        actionLabel: "Add Diff",
        capPerWorkspace: 1,
        create: vi.fn(async () => "ws-new"),
      });

      const respGroup = await dispatch(
        rpc("tools/call", {
          name: "add_dashboard_to_group",
          arguments: { group_id: "nope", contribution_id: "diff" },
        }),
      );
      expect((respGroup as any).error).toBeDefined();

      seedGroup("g1");
      const respContrib = await dispatch(
        rpc("tools/call", {
          name: "add_dashboard_to_group",
          arguments: { group_id: "g1", contribution_id: "ghost" },
        }),
      );
      expect((respContrib as any).error).toBeDefined();
    });
  });

  describe("remove_dashboard_from_group", () => {
    it("returns removed=false when no workspace exists for the pair", async () => {
      seedGroup("g1");
      registerDashboardContribution({
        id: "diff",
        source: "diff-viewer",
        label: "Diff",
        actionLabel: "Add Diff",
        capPerWorkspace: 1,
        create: vi.fn(async () => "ws-new"),
      });

      const resp = await dispatch(
        rpc("tools/call", {
          name: "remove_dashboard_from_group",
          arguments: { group_id: "g1", contribution_id: "diff" },
        }),
      );
      expect((resp as any).result.structuredContent.removed).toBe(false);
    });

    it("rejects an autoProvision contribution", async () => {
      seedGroup("g1");
      registerDashboardContribution({
        id: "agentic",
        source: "agentic-orchestrator",
        label: "Agentic",
        actionLabel: "Add Agentic",
        capPerWorkspace: 1,
        autoProvision: true,
        create: vi.fn(async () => "ws-x"),
      });

      const resp = await dispatch(
        rpc("tools/call", {
          name: "remove_dashboard_from_group",
          arguments: { group_id: "g1", contribution_id: "agentic" },
        }),
      );
      expect((resp as any).error).toBeDefined();
    });
  });
});
