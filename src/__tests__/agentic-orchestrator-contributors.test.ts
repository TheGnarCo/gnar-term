/**
 * Tests for the contributor registrations made by agentic-orchestrator
 * during activation:
 *   - "project" parentType — returns orchestrators belonging to that
 *     project (filtered by parentProjectId), each as
 *     { kind: "agent-orchestrator", id: orchestratorId }
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "get_home") return "/home/test";
    return undefined;
  }),
  convertFileSrc: vi.fn((p: string) => p),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn().mockResolvedValue(""),
  writeText: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn().mockResolvedValue(true),
  requestPermission: vi.fn().mockResolvedValue("granted"),
  sendNotification: vi.fn(),
}));
vi.mock("../lib/services/extension-state", () => ({
  loadExtensionState: vi.fn().mockResolvedValue({}),
  saveExtensionState: vi.fn().mockResolvedValue(undefined),
  deleteExtensionState: vi.fn().mockResolvedValue(undefined),
}));

const { configRef } = vi.hoisted(() => {
  const ref: { current: Record<string, unknown> } = { current: {} };
  return { configRef: ref };
});

vi.mock("../lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/config")>();
  return {
    ...actual,
    getConfig: () => configRef.current,
    saveConfig: vi.fn(async (updates: Record<string, unknown>) => {
      configRef.current = { ...configRef.current, ...updates };
    }),
  };
});

type StubWs = {
  id: string;
  name: string;
  metadata?: Record<string, unknown>;
  splitRoot: {
    type: "pane";
    pane: { id: string; surfaces: []; activeSurfaceId: null };
  };
  activePaneId: null;
};

const { workspacesStore } = vi.hoisted(() => {
  const subs = new Set<(v: StubWs[]) => void>();
  let value: StubWs[] = [];
  const store = {
    subscribe(fn: (v: StubWs[]) => void) {
      subs.add(fn);
      fn(value);
      return () => subs.delete(fn);
    },
    set(v: StubWs[]) {
      value = v;
      for (const s of subs) s(v);
    },
    update(fn: (v: StubWs[]) => StubWs[]) {
      value = fn(value);
      for (const s of subs) s(value);
    },
  };
  return { workspacesStore: store };
});

function mkWs(
  id: string,
  metadata?: Record<string, unknown>,
): {
  id: string;
  name: string;
  metadata?: Record<string, unknown>;
  splitRoot: {
    type: "pane";
    pane: { id: string; surfaces: []; activeSurfaceId: null };
  };
  activePaneId: null;
} {
  return {
    id,
    name: id,
    metadata,
    splitRoot: {
      type: "pane",
      pane: { id: `${id}-pane`, surfaces: [], activeSurfaceId: null },
    },
    activePaneId: null,
  };
}

vi.mock("../lib/stores/workspace", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/stores/workspace")>();
  return {
    ...actual,
    workspaces: workspacesStore,
  };
});

import {
  registerExtension,
  activateExtension,
  resetExtensions,
} from "../lib/services/extension-loader";
import {
  getChildRowsFor,
  resetChildRowContributors,
} from "../lib/services/child-row-contributor-registry";
import {
  agenticOrchestratorManifest,
  registerAgenticOrchestratorExtension,
} from "../extensions/agentic-orchestrator";
import { _resetOrchestratorService } from "../extensions/agentic-orchestrator/orchestrator-service";
import type { AgentOrchestrator } from "../lib/config";

describe("agentic-orchestrator child-row contributors", () => {
  beforeEach(async () => {
    await resetExtensions();
    resetChildRowContributors();
    _resetOrchestratorService();
    configRef.current = {};
    workspacesStore.set([]);
  });

  it('contributes orchestrators under "project" rows by parentProjectId', async () => {
    const orchestrators: AgentOrchestrator[] = [
      {
        id: "d-root",
        name: "Root",
        baseDir: "/work",
        color: "purple",
        path: "/abs/root.md",
        createdAt: "2026-01-01",
      },
      {
        id: "d-p1-a",
        name: "P1 Dash A",
        baseDir: "/work/p1",
        color: "blue",
        path: "/abs/p1a.md",
        createdAt: "2026-01-01",
        parentProjectId: "project-1",
      },
      {
        id: "d-p1-b",
        name: "P1 Dash B",
        baseDir: "/work/p1",
        color: "green",
        path: "/abs/p1b.md",
        createdAt: "2026-01-01",
        parentProjectId: "project-1",
      },
      {
        id: "d-p2",
        name: "P2 Dash",
        baseDir: "/work/p2",
        color: "red",
        path: "/abs/p2.md",
        createdAt: "2026-01-01",
        parentProjectId: "project-2",
      },
    ];
    configRef.current = { agentOrchestrators: orchestrators };

    registerExtension(
      agenticOrchestratorManifest,
      registerAgenticOrchestratorExtension,
    );
    await activateExtension("agentic-orchestrator");

    expect(getChildRowsFor("project", "project-1")).toEqual([
      { kind: "agent-orchestrator", id: "d-p1-a" },
      { kind: "agent-orchestrator", id: "d-p1-b" },
    ]);
    expect(getChildRowsFor("project", "project-2")).toEqual([
      { kind: "agent-orchestrator", id: "d-p2" },
    ]);
    // Root-level orchestrators (no parentProjectId) don't show up under
    // any project — they're root rows on the sidebar instead.
    expect(getChildRowsFor("project", "no-such-project")).toEqual([]);
  });

  it('does not register an "orchestrator" child-row contributor for workspaces', async () => {
    // AgentOrchestratorRow renders nested worktree workspaces directly
    // via WorkspaceListView — no contributor needed.
    workspacesStore.set([
      mkWs("ws-o1-a", { parentOrchestratorId: "orch-1" }),
      mkWs("ws-o1-b", { parentOrchestratorId: "orch-1" }),
    ]);

    registerExtension(
      agenticOrchestratorManifest,
      registerAgenticOrchestratorExtension,
    );
    await activateExtension("agentic-orchestrator");

    expect(getChildRowsFor("orchestrator", "orch-1")).toEqual([]);
  });
});
