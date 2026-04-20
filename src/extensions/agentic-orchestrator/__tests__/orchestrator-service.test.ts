/**
 * Tests for the orchestrator service — entity CRUD, persistence, the
 * reactive store, and the Dashboard-workspace lifecycle invariant (each
 * orchestrator owns a single Dashboard workspace created eagerly and
 * closed on orchestrator deletion).
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
      agentOrchestrators?: import("../../../lib/config").AgentOrchestrator[];
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

const { createWorkspaceFromDefMock, closeWorkspaceMock } = vi.hoisted(() => ({
  createWorkspaceFromDefMock: vi.fn().mockResolvedValue("ws-new"),
  closeWorkspaceMock: vi.fn(),
}));

vi.mock("../../../lib/services/workspace-service", () => ({
  createWorkspaceFromDef: createWorkspaceFromDefMock,
  closeWorkspace: closeWorkspaceMock,
}));

import {
  createOrchestrator,
  orchestratorScopedAgents,
  deleteOrchestrator,
  getOrchestrator,
  getOrchestrators,
  getOrchestratorsForProject,
  loadOrchestrators,
  recolorOrchestrator,
  renameOrchestrator,
  orchestratorsStore,
  _resetOrchestratorService,
  DASHBOARD_METADATA_KEY,
  ORCHESTRATOR_WORKSPACE_META_KEY,
} from "../orchestrator-service";
import { workspaces } from "../../../lib/stores/workspace";
import type { AgentRef } from "../../api";
import type { AgentOrchestrator } from "../../../lib/config";
import type { Workspace } from "../../../lib/types";

describe("orchestrator-service", () => {
  beforeEach(() => {
    configRef.current = {};
    saveConfigMock.mockClear();
    createWorkspaceFromDefMock.mockClear();
    createWorkspaceFromDefMock.mockResolvedValue("ws-new");
    closeWorkspaceMock.mockClear();
    _resetOrchestratorService();
    workspaces.set([]);
  });

  describe("createOrchestrator", () => {
    it("creates an orchestrator + Dashboard workspace, persists both with link", async () => {
      const o = await createOrchestrator({
        name: "My Agent",
        baseDir: "/work/proj",
        pathOverride: "/tmp/x.md",
      });

      expect(o.id).toBeTruthy();
      expect(o.name).toBe("My Agent");
      expect(o.baseDir).toBe("/work/proj");
      expect(o.color).toBe("purple");
      expect(o.path).toBe("/tmp/x.md");
      expect(o.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(o.parentGroupId).toBeUndefined();
      expect(o.dashboardWorkspaceId).toBe("ws-new");

      expect(createWorkspaceFromDefMock).toHaveBeenCalledTimes(1);
      const def = createWorkspaceFromDefMock.mock.calls[0]![0] as {
        name: string;
        metadata?: Record<string, unknown>;
        layout: { pane: { surfaces: Array<{ type: string; path: string }> } };
      };
      expect(def.name).toBe("Dashboard");
      expect(def.metadata?.[DASHBOARD_METADATA_KEY]).toBe(true);
      expect(def.metadata?.[ORCHESTRATOR_WORKSPACE_META_KEY]).toBe(o.id);
      expect(def.layout.pane.surfaces[0]).toMatchObject({
        type: "preview",
        path: o.path,
      });

      expect(saveConfigMock).toHaveBeenCalledTimes(1);
      expect(configRef.current.agentOrchestrators).toHaveLength(1);
      expect(configRef.current.agentOrchestrators![0].id).toBe(o.id);
      expect(
        configRef.current.agentOrchestrators![0].dashboardWorkspaceId,
      ).toBe("ws-new");

      expect(getOrchestrators()).toHaveLength(1);
      expect(get(orchestratorsStore)).toHaveLength(1);
    });

    it("respects an explicit color", async () => {
      const o = await createOrchestrator({
        name: "x",
        baseDir: "/x",
        color: "#ff8800",
        pathOverride: "/tmp/x.md",
      });
      expect(o.color).toBe("#ff8800");
    });

    it("derives root-level path under ~/.config/gnar-term/orchestrators/<id>.md", async () => {
      const o = await createOrchestrator({ name: "n", baseDir: "/work/proj" });
      expect(o.path).toBe(
        `/home/test/.config/gnar-term/orchestrators/${o.id}.md`,
      );
    });

    it("derives project-nested path under <baseDir>/.gnar-term/orchestrators/<id>.md", async () => {
      const o = await createOrchestrator({
        name: "n",
        baseDir: "/work/proj",
        parentGroupId: "proj-1",
      });
      expect(o.path).toBe(`/work/proj/.gnar-term/orchestrators/${o.id}.md`);
      expect(o.parentGroupId).toBe("proj-1");
    });
  });

  describe("getOrchestrator", () => {
    it("returns the matching entry or undefined", async () => {
      const o = await createOrchestrator({
        name: "n",
        baseDir: "/x",
        pathOverride: "/tmp/x.md",
      });
      expect(getOrchestrator(o.id)?.id).toBe(o.id);
      expect(getOrchestrator("missing")).toBeUndefined();
    });
  });

  describe("getOrchestratorsForProject", () => {
    it("filters by parentGroupId; null returns root-level", async () => {
      let i = 0;
      createWorkspaceFromDefMock.mockImplementation(async () => `ws-${++i}`);

      const root = await createOrchestrator({
        name: "root",
        baseDir: "/r",
        pathOverride: "/tmp/r.md",
      });
      const nested1 = await createOrchestrator({
        name: "n1",
        baseDir: "/n",
        parentGroupId: "proj-1",
        pathOverride: "/tmp/n1.md",
      });
      const nested2 = await createOrchestrator({
        name: "n2",
        baseDir: "/n",
        parentGroupId: "proj-1",
        pathOverride: "/tmp/n2.md",
      });
      await createOrchestrator({
        name: "other",
        baseDir: "/o",
        parentGroupId: "proj-2",
        pathOverride: "/tmp/o.md",
      });

      const rootOnly = getOrchestratorsForProject(null);
      expect(rootOnly).toHaveLength(1);
      expect(rootOnly[0].id).toBe(root.id);

      const proj1 = getOrchestratorsForProject("proj-1");
      expect(proj1.map((o) => o.id).sort()).toEqual(
        [nested1.id, nested2.id].sort(),
      );

      expect(getOrchestratorsForProject("proj-missing")).toEqual([]);
    });
  });

  describe("renameOrchestrator", () => {
    it("updates the name and persists", async () => {
      const o = await createOrchestrator({
        name: "Old",
        baseDir: "/x",
        pathOverride: "/tmp/x.md",
      });
      saveConfigMock.mockClear();

      await renameOrchestrator(o.id, "New");

      expect(getOrchestrator(o.id)?.name).toBe("New");
      expect(get(orchestratorsStore)[0].name).toBe("New");
      expect(saveConfigMock).toHaveBeenCalledTimes(1);
      expect(configRef.current.agentOrchestrators![0].name).toBe("New");
    });
  });

  describe("recolorOrchestrator", () => {
    it("updates color and persists", async () => {
      const o = await createOrchestrator({
        name: "n",
        baseDir: "/x",
        pathOverride: "/tmp/x.md",
      });
      saveConfigMock.mockClear();

      await recolorOrchestrator(o.id, "blue");

      expect(getOrchestrator(o.id)?.color).toBe("blue");
      expect(get(orchestratorsStore)[0].color).toBe("blue");
      expect(configRef.current.agentOrchestrators![0].color).toBe("blue");
    });
  });

  describe("deleteOrchestrator", () => {
    it("removes the orchestrator and closes its Dashboard workspace", async () => {
      createWorkspaceFromDefMock.mockResolvedValueOnce("ws-a");
      const o = await createOrchestrator({
        name: "n",
        baseDir: "/x",
        pathOverride: "/tmp/x.md",
      });
      workspaces.set([
        {
          id: "ws-a",
          name: "Dashboard",
          splitRoot: {
            type: "pane",
            pane: { id: "p", surfaces: [], activeSurfaceId: null },
          },
          activePaneId: "p",
        } as unknown as Workspace,
      ]);

      await deleteOrchestrator(o.id);

      expect(closeWorkspaceMock).toHaveBeenCalledWith(0);
      expect(getOrchestrators()).toHaveLength(0);
      expect(configRef.current.agentOrchestrators).toEqual([]);
    });
  });

  describe("loadOrchestrators", () => {
    it("hydrates the store from config", () => {
      configRef.current = {
        agentOrchestrators: [
          {
            id: "o1",
            name: "Hydrated",
            baseDir: "/h",
            color: "purple",
            path: "/h/.md",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      };

      loadOrchestrators();

      expect(getOrchestrators()).toHaveLength(1);
      expect(get(orchestratorsStore)[0].name).toBe("Hydrated");
    });

    it("hydrates to empty when config has no agentOrchestrators", () => {
      configRef.current = {};
      loadOrchestrators();
      expect(getOrchestrators()).toEqual([]);
    });
  });

  describe("orchestratorScopedAgents", () => {
    const orchestrator: AgentOrchestrator = {
      id: "orch-1",
      name: "Orch",
      baseDir: "/work/repo",
      color: "purple",
      path: "/abs/orch.md",
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
      const result = orchestratorScopedAgents(orchestrator, [
        makeAgent("ws-a"),
      ]);
      expect(result.map((a) => a.workspaceId)).toEqual(["ws-a"]);
    });

    it("excludes agents whose workspace cwd is a sibling directory", () => {
      workspaces.set([
        makeWorkspace("ws-sibling", { cwd: "/work/repo-agent-xyz" }),
      ]);
      const result = orchestratorScopedAgents(orchestrator, [
        makeAgent("ws-sibling"),
      ]);
      expect(result).toEqual([]);
    });

    it("includes agents whose workspace metadata.parentOrchestratorId matches even when cwd is outside baseDir", () => {
      workspaces.set([
        makeWorkspace("ws-worktree", {
          cwd: "/work/repo-agent-xyz",
          metadata: { parentOrchestratorId: "orch-1" },
        }),
      ]);
      const result = orchestratorScopedAgents(orchestrator, [
        makeAgent("ws-worktree"),
      ]);
      expect(result.map((a) => a.workspaceId)).toEqual(["ws-worktree"]);
    });

    it("excludes agents whose metadata parentOrchestratorId points at a different orchestrator", () => {
      workspaces.set([
        makeWorkspace("ws-other", {
          cwd: "/elsewhere",
          metadata: { parentOrchestratorId: "some-other" },
        }),
      ]);
      const result = orchestratorScopedAgents(orchestrator, [
        makeAgent("ws-other"),
      ]);
      expect(result).toEqual([]);
    });
  });
});
