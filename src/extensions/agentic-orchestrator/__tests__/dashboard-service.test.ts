/**
 * Tests for the dashboard service — entity CRUD, persistence, and the
 * reactive store. The service is the data layer for AgentDashboard
 * entities; sidebar rows + widgets land in P5/P6.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "get_home") return "/home/test";
    return undefined;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

const { configRef, saveConfigMock } = vi.hoisted(() => {
  const ref: {
    current: {
      agentDashboards?: import("../../../lib/config").AgentDashboard[];
    };
  } = { current: {} };
  const mock = vi.fn(
    async (updates: Partial<import("../../../lib/config").GnarTermConfig>) => {
      ref.current = { ...ref.current, ...updates };
    },
  );
  return { configRef: ref, saveConfigMock: mock };
});

vi.mock("../../../lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/config")>();
  return {
    ...actual,
    getConfig: () => configRef.current,
    saveConfig: saveConfigMock,
  };
});

import {
  createDashboard,
  dashboardScopedAgents,
  deleteDashboard,
  getDashboard,
  getDashboards,
  getDashboardsForProject,
  loadDashboards,
  recolorDashboard,
  renameDashboard,
  dashboardsStore,
  _resetDashboardService,
} from "../dashboard-service";
import { workspaces } from "../../../lib/stores/workspace";
import type { AgentRef } from "../../api";
import type { AgentDashboard } from "../../../lib/config";
import type { Workspace } from "../../../lib/types";

describe("dashboard-service", () => {
  beforeEach(() => {
    configRef.current = {};
    saveConfigMock.mockClear();
    _resetDashboardService();
  });

  describe("createDashboard", () => {
    it("creates a dashboard with id, createdAt, default color, and persists", async () => {
      const d = await createDashboard({
        name: "My Agent",
        baseDir: "/work/proj",
        pathOverride: "/tmp/x.md",
      });

      expect(d.id).toBeTruthy();
      expect(d.name).toBe("My Agent");
      expect(d.baseDir).toBe("/work/proj");
      expect(d.color).toBe("purple");
      expect(d.path).toBe("/tmp/x.md");
      expect(d.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(d.parentProjectId).toBeUndefined();

      expect(saveConfigMock).toHaveBeenCalledTimes(1);
      expect(configRef.current.agentDashboards).toHaveLength(1);
      expect(configRef.current.agentDashboards![0].id).toBe(d.id);

      expect(getDashboards()).toHaveLength(1);
      expect(get(dashboardsStore)).toHaveLength(1);
    });

    it("respects an explicit color", async () => {
      const d = await createDashboard({
        name: "x",
        baseDir: "/x",
        color: "#ff8800",
        pathOverride: "/tmp/x.md",
      });
      expect(d.color).toBe("#ff8800");
    });

    it("derives root-level path under ~/.config/gnar-term/dashboards/<id>.md", async () => {
      const d = await createDashboard({ name: "n", baseDir: "/work/proj" });
      expect(d.path).toBe(`/home/test/.config/gnar-term/dashboards/${d.id}.md`);
    });

    it("derives project-nested path under <baseDir>/.gnar-term/dashboards/<id>.md", async () => {
      const d = await createDashboard({
        name: "n",
        baseDir: "/work/proj",
        parentProjectId: "proj-1",
      });
      expect(d.path).toBe(`/work/proj/.gnar-term/dashboards/${d.id}.md`);
      expect(d.parentProjectId).toBe("proj-1");
    });

    it("allows two dashboards with the same name (distinct ids)", async () => {
      const a = await createDashboard({
        name: "Same",
        baseDir: "/x",
        pathOverride: "/tmp/a.md",
      });
      const b = await createDashboard({
        name: "Same",
        baseDir: "/x",
        pathOverride: "/tmp/b.md",
      });
      expect(a.id).not.toBe(b.id);
      expect(getDashboards()).toHaveLength(2);
    });
  });

  describe("getDashboard", () => {
    it("returns the matching entry or undefined", async () => {
      const d = await createDashboard({
        name: "n",
        baseDir: "/x",
        pathOverride: "/tmp/x.md",
      });
      expect(getDashboard(d.id)?.id).toBe(d.id);
      expect(getDashboard("missing")).toBeUndefined();
    });
  });

  describe("getDashboardsForProject", () => {
    it("filters by parentProjectId; null returns root-level", async () => {
      const root = await createDashboard({
        name: "root",
        baseDir: "/r",
        pathOverride: "/tmp/r.md",
      });
      const nested1 = await createDashboard({
        name: "n1",
        baseDir: "/n",
        parentProjectId: "proj-1",
        pathOverride: "/tmp/n1.md",
      });
      const nested2 = await createDashboard({
        name: "n2",
        baseDir: "/n",
        parentProjectId: "proj-1",
        pathOverride: "/tmp/n2.md",
      });
      await createDashboard({
        name: "other",
        baseDir: "/o",
        parentProjectId: "proj-2",
        pathOverride: "/tmp/o.md",
      });

      const rootOnly = getDashboardsForProject(null);
      expect(rootOnly).toHaveLength(1);
      expect(rootOnly[0].id).toBe(root.id);

      const proj1 = getDashboardsForProject("proj-1");
      expect(proj1.map((d) => d.id).sort()).toEqual(
        [nested1.id, nested2.id].sort(),
      );

      expect(getDashboardsForProject("proj-missing")).toEqual([]);
    });
  });

  describe("renameDashboard", () => {
    it("updates the name and persists", async () => {
      const d = await createDashboard({
        name: "Old",
        baseDir: "/x",
        pathOverride: "/tmp/x.md",
      });
      saveConfigMock.mockClear();

      await renameDashboard(d.id, "New");

      expect(getDashboard(d.id)?.name).toBe("New");
      expect(get(dashboardsStore)[0].name).toBe("New");
      expect(saveConfigMock).toHaveBeenCalledTimes(1);
      expect(configRef.current.agentDashboards![0].name).toBe("New");
    });
  });

  describe("recolorDashboard", () => {
    it("updates color and persists", async () => {
      const d = await createDashboard({
        name: "n",
        baseDir: "/x",
        pathOverride: "/tmp/x.md",
      });
      saveConfigMock.mockClear();

      await recolorDashboard(d.id, "blue");

      expect(getDashboard(d.id)?.color).toBe("blue");
      expect(get(dashboardsStore)[0].color).toBe("blue");
      expect(configRef.current.agentDashboards![0].color).toBe("blue");
    });
  });

  describe("deleteDashboard", () => {
    it("removes from config and store", async () => {
      const d = await createDashboard({
        name: "n",
        baseDir: "/x",
        pathOverride: "/tmp/x.md",
      });
      const other = await createDashboard({
        name: "keep",
        baseDir: "/y",
        pathOverride: "/tmp/y.md",
      });

      await deleteDashboard(d.id);

      expect(getDashboards().map((x) => x.id)).toEqual([other.id]);
      expect(get(dashboardsStore).map((x) => x.id)).toEqual([other.id]);
      expect(configRef.current.agentDashboards).toHaveLength(1);
    });
  });

  describe("loadDashboards", () => {
    it("hydrates the store from config", () => {
      configRef.current = {
        agentDashboards: [
          {
            id: "d1",
            name: "Hydrated",
            baseDir: "/h",
            color: "purple",
            path: "/h/.md",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      };

      loadDashboards();

      expect(getDashboards()).toHaveLength(1);
      expect(get(dashboardsStore)[0].name).toBe("Hydrated");
    });

    it("hydrates to empty when config has no agentDashboards", () => {
      configRef.current = {};
      loadDashboards();
      expect(getDashboards()).toEqual([]);
    });
  });

  describe("dashboardScopedAgents", () => {
    const dashboard: AgentDashboard = {
      id: "dash-1",
      name: "Dash",
      baseDir: "/work/repo",
      color: "purple",
      path: "/abs/dash.md",
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    function makeWorkspace(
      id: string,
      opts: { cwd?: string; metadata?: Record<string, unknown> } = {},
    ): Workspace {
      const surfaces = opts.cwd
        ? [
            {
              kind: "terminal" as const,
              id: `${id}-s`,
              cwd: opts.cwd,
            } as unknown as import("../../../lib/types").Surface,
          ]
        : [];
      return {
        id,
        name: id,
        splitRoot: {
          type: "pane",
          pane: {
            id: `${id}-p`,
            surfaces,
            activeSurfaceId: null,
          },
        },
        activePaneId: `${id}-p`,
        ...(opts.metadata ? { metadata: opts.metadata } : {}),
      };
    }

    function makeAgent(workspaceId: string): AgentRef {
      return {
        agentId: `agent-${workspaceId}`,
        agentName: "claude-code",
        workspaceId,
        surfaceId: `${workspaceId}-s`,
        status: "running",
        lastStatusChange: "2026-01-01T00:00:00.000Z",
      } as AgentRef;
    }

    beforeEach(() => {
      workspaces.set([]);
    });

    it("includes agents whose workspace cwd is under baseDir", () => {
      workspaces.set([makeWorkspace("ws-a", { cwd: "/work/repo/src" })]);
      const result = dashboardScopedAgents(dashboard, [makeAgent("ws-a")]);
      expect(result.map((a) => a.workspaceId)).toEqual(["ws-a"]);
    });

    it("excludes agents whose workspace cwd is a sibling directory", () => {
      workspaces.set([
        makeWorkspace("ws-sibling", { cwd: "/work/repo-agent-xyz" }),
      ]);
      const result = dashboardScopedAgents(dashboard, [
        makeAgent("ws-sibling"),
      ]);
      expect(result).toEqual([]);
    });

    it("includes agents whose workspace metadata.parentDashboardId matches even when cwd is outside baseDir", () => {
      workspaces.set([
        makeWorkspace("ws-worktree", {
          cwd: "/work/repo-agent-xyz",
          metadata: { parentDashboardId: "dash-1" },
        }),
      ]);
      const result = dashboardScopedAgents(dashboard, [
        makeAgent("ws-worktree"),
      ]);
      expect(result.map((a) => a.workspaceId)).toEqual(["ws-worktree"]);
    });

    it("excludes agents whose metadata parentDashboardId points at a different dashboard", () => {
      workspaces.set([
        makeWorkspace("ws-other", {
          cwd: "/elsewhere",
          metadata: { parentDashboardId: "some-other-dashboard" },
        }),
      ]);
      const result = dashboardScopedAgents(dashboard, [makeAgent("ws-other")]);
      expect(result).toEqual([]);
    });
  });
});
