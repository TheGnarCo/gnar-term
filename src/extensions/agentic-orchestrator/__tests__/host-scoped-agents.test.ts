/**
 * Tests for `hostScopedAgentsStore` — the scope-derivation helper that
 * powers the agent-list / kanban / task-spawner widgets. Mirrors the
 * spec §5.3 rules: global scope emits all agents; group scope emits
 * agents whose workspace has matching `metadata.parentWorkspaceId` OR whose raw
 * terminal CWD falls under the group's `path` and that haven't been
 * claimed yet; no-scope emits an empty list.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get, writable } from "svelte/store";
import { tick } from "svelte";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));
vi.mock("../../../lib/services/extension-state", () => ({
  loadExtensionState: vi.fn().mockResolvedValue({}),
  saveExtensionState: vi.fn().mockResolvedValue(undefined),
  deleteExtensionState: vi.fn().mockResolvedValue(undefined),
}));

import type { AgentRef as DetectedAgent } from "../../api";
import type { ExtensionAPI } from "../../api";
import { hostScopedAgentsStore } from "../widget-helpers";
import { nestedWorkspaces } from "../../../lib/stores/workspace";
import {
  claimWorkspace,
  resetClaimedWorkspaces,
} from "../../../lib/services/claimed-workspace-registry";
import {
  setWorkspaces,
  resetWorkspacesForTest,
} from "../../../lib/stores/workspace-groups";
import type { DashboardHostContext } from "../../../lib/contexts/dashboard-host";

function makeAgent(overrides: Partial<DetectedAgent> = {}): DetectedAgent {
  return {
    agentId: overrides.agentId ?? "agent-1",
    agentName: overrides.agentName ?? "A",
    surfaceId: overrides.surfaceId ?? "surf-1",
    workspaceId: overrides.workspaceId ?? "ws-1",
    status: overrides.status ?? "running",
    createdAt: overrides.createdAt ?? "2026-04-20T00:00:00.000Z",
    lastStatusChange: overrides.lastStatusChange ?? "2026-04-20T00:00:00.000Z",
  };
}

function makeApi(agentList: DetectedAgent[]): ExtensionAPI {
  return {
    agents: writable(agentList),
  } as unknown as ExtensionAPI;
}

function seedWorkspace(
  id: string,
  opts: { metadata?: Record<string, unknown>; cwd?: string } = {},
): { id: string; name: string; metadata?: Record<string, unknown> } {
  return {
    id,
    name: id,
    activePaneId: "p",
    splitRoot: {
      type: "pane",
      pane: {
        id: "p",
        activeSurfaceId: "s1",
        surfaces: [
          {
            id: "s1",
            kind: "terminal",
            title: "t",
            cwd: opts.cwd ?? "",
            ptyId: 1,
            terminal: { dispose: vi.fn(), focus: vi.fn() },
          },
        ],
      },
    },
    ...(opts.metadata ? { metadata: opts.metadata } : {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("hostScopedAgentsStore", () => {
  beforeEach(() => {
    nestedWorkspaces.set([]);
    resetClaimedWorkspaces();
    resetWorkspacesForTest();
  });

  it("no host → empty list", async () => {
    const api = makeApi([makeAgent()]);
    const store = hostScopedAgentsStore(api, null);
    await tick();
    expect(get(store)).toEqual([]);
  });

  it("scope 'none' (host with no parentWorkspaceId / no global marker) → empty list", async () => {
    const api = makeApi([makeAgent()]);
    const host: DashboardHostContext = { metadata: {} };
    const store = hostScopedAgentsStore(api, host);
    await tick();
    expect(get(store)).toEqual([]);
  });

  it("global scope → all agents regardless of workspace", async () => {
    const api = makeApi([
      makeAgent({ agentId: "a1", workspaceId: "ws-a" }),
      makeAgent({ agentId: "a2", workspaceId: "ws-b" }),
    ]);
    const host: DashboardHostContext = {
      metadata: { isGlobalAgenticDashboard: true },
    };
    const store = hostScopedAgentsStore(api, host);
    await tick();
    const ids = get(store).map((a) => a.agentId);
    expect(ids).toEqual(["a1", "a2"]);
  });

  it("group scope → agents whose workspace metadata.parentWorkspaceId matches", async () => {
    nestedWorkspaces.set([
      seedWorkspace("ws-in", { metadata: { parentWorkspaceId: "grp-1" } }),
      seedWorkspace("ws-out", { metadata: { parentWorkspaceId: "grp-2" } }),
      seedWorkspace("ws-none", {}),
    ]);
    setWorkspaces([
      {
        id: "grp-1",
        name: "One",
        path: "/work/one",
        color: "blue",
        groupDashboardEnabled: true,
        workspaceIds: ["ws-in"],
      },
    ]);
    const api = makeApi([
      makeAgent({ agentId: "a-in", workspaceId: "ws-in" }),
      makeAgent({ agentId: "a-out", workspaceId: "ws-out" }),
      makeAgent({ agentId: "a-none", workspaceId: "ws-none" }),
    ]);
    const host: DashboardHostContext = {
      metadata: { parentWorkspaceId: "grp-1" },
    };
    const store = hostScopedAgentsStore(api, host);
    await tick();
    expect(get(store).map((a) => a.agentId)).toEqual(["a-in"]);
  });

  it("group scope → includes unclaimed nestedWorkspaces whose CWD falls under group.path", async () => {
    nestedWorkspaces.set([
      seedWorkspace("ws-under", { cwd: "/work/one/sub" }),
      seedWorkspace("ws-elsewhere", { cwd: "/other/path" }),
    ]);
    setWorkspaces([
      {
        id: "grp-1",
        name: "One",
        path: "/work/one",
        color: "blue",
        groupDashboardEnabled: true,
        workspaceIds: [],
      },
    ]);
    const api = makeApi([
      makeAgent({ agentId: "a-under", workspaceId: "ws-under" }),
      makeAgent({ agentId: "a-else", workspaceId: "ws-elsewhere" }),
    ]);
    const host: DashboardHostContext = {
      metadata: { parentWorkspaceId: "grp-1" },
    };
    const store = hostScopedAgentsStore(api, host);
    await tick();
    expect(get(store).map((a) => a.agentId)).toEqual(["a-under"]);
  });

  it("group scope → excludes claimed nestedWorkspaces even when CWD matches (they belong to another owner)", async () => {
    nestedWorkspaces.set([seedWorkspace("ws-under", { cwd: "/work/one/sub" })]);
    setWorkspaces([
      {
        id: "grp-1",
        name: "One",
        path: "/work/one",
        color: "blue",
        groupDashboardEnabled: true,
        workspaceIds: [],
      },
    ]);
    claimWorkspace("ws-under", "someone-else");
    const api = makeApi([
      makeAgent({ agentId: "a-under", workspaceId: "ws-under" }),
    ]);
    const host: DashboardHostContext = {
      metadata: { parentWorkspaceId: "grp-1" },
    };
    const store = hostScopedAgentsStore(api, host);
    await tick();
    expect(get(store)).toEqual([]);
  });

  it("group scope → prefix-only match: sibling paths don't leak in", async () => {
    nestedWorkspaces.set([
      seedWorkspace("ws-sibling", { cwd: "/work/one-other/sub" }),
    ]);
    setWorkspaces([
      {
        id: "grp-1",
        name: "One",
        path: "/work/one",
        color: "blue",
        groupDashboardEnabled: true,
        workspaceIds: [],
      },
    ]);
    const api = makeApi([
      makeAgent({ agentId: "a-sib", workspaceId: "ws-sibling" }),
    ]);
    const host: DashboardHostContext = {
      metadata: { parentWorkspaceId: "grp-1" },
    };
    const store = hostScopedAgentsStore(api, host);
    await tick();
    expect(get(store)).toEqual([]);
  });

  it("group scope → includes workspace in group.workspaceIds even when claimed and no metadata.parentWorkspaceId", async () => {
    // Regression test: promote-to-group calls addNestedWorkspaceToWorkspace + claimWorkspace
    // but does NOT stamp metadata.parentWorkspaceId. Without criterion 2 in hostScopedAgentsStore,
    // the claim guard ($claimedIds.has) would block the CWD fallback and the agent
    // would be invisible in the group's Kanban dashboard.
    nestedWorkspaces.set([
      seedWorkspace("ws-native", { cwd: "" }), // no cwd, no metadata.parentWorkspaceId
    ]);
    setWorkspaces([
      {
        id: "grp-1",
        name: "One",
        path: "/work/one",
        color: "blue",
        groupDashboardEnabled: true,
        workspaceIds: ["ws-native"], // explicitly listed in the group
      },
    ]);
    // Simulate the claim that promote-to-group installs.
    claimWorkspace("ws-native", "core");
    const api = makeApi([
      makeAgent({ agentId: "a-native", workspaceId: "ws-native" }),
    ]);
    const host: DashboardHostContext = {
      metadata: { parentWorkspaceId: "grp-1" },
    };
    const store = hostScopedAgentsStore(api, host);
    await tick();
    expect(get(store).map((a) => a.agentId)).toEqual(["a-native"]);
  });

  it("group scope → workspace in group.workspaceIds for a different group is not included", async () => {
    nestedWorkspaces.set([seedWorkspace("ws-other", { cwd: "" })]);
    setWorkspaces([
      {
        id: "grp-1",
        name: "One",
        path: "/work/one",
        color: "blue",
        groupDashboardEnabled: true,
        workspaceIds: [],
      },
      {
        id: "grp-2",
        name: "Two",
        path: "/work/two",
        color: "red",
        groupDashboardEnabled: true,
        workspaceIds: ["ws-other"],
      },
    ]);
    const api = makeApi([
      makeAgent({ agentId: "a-other", workspaceId: "ws-other" }),
    ]);
    const host: DashboardHostContext = {
      metadata: { parentWorkspaceId: "grp-1" },
    };
    const store = hostScopedAgentsStore(api, host);
    await tick();
    expect(get(store)).toEqual([]);
  });
});
