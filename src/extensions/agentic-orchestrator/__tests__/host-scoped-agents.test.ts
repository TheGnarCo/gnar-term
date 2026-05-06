/**
 * Tests for `hostScopedAgentsStore` — the scope-derivation helper that
 * powers the agent-list / kanban / task-spawner widgets. Mirrors the
 * spec §5.3 rules: global scope emits all agents; workspace scope emits
 * agents whose child workspace has matching `metadata.rootWorkspaceId`
 * OR whose raw terminal CWD falls under the workspace's `path` and that
 * haven't been claimed yet; no-scope emits an empty list.
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
import { workspaces } from "../../../lib/stores/workspace";
import {
  claimWorkspace,
  resetClaimedWorkspaces,
} from "../../../lib/services/claimed-workspace-registry";
import { resetWorkspacesForTest } from "../../../lib/stores/workspace";
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

function makeRoot(
  id: string,
  path: string,
  branchedWorkspaceIds: string[] = [],
  color: string = "blue",
): unknown {
  return {
    id,
    name: id,
    path,
    color,
    branchedWorkspaceIds,
    isGit: false,
    createdAt: "2026-01-01",
    splitRoot: {
      type: "pane",
      pane: { id: `${id}-p`, surfaces: [], activeSurfaceId: null },
    },
    activePaneId: `${id}-p`,
  };
}

describe("hostScopedAgentsStore", () => {
  beforeEach(() => {
    workspaces.set([]);
    resetClaimedWorkspaces();
    resetWorkspacesForTest();
  });

  it("no host → empty list", async () => {
    const api = makeApi([makeAgent()]);
    const store = hostScopedAgentsStore(api, null);
    await tick();
    expect(get(store)).toEqual([]);
  });

  it("scope 'none' (host with no rootWorkspaceId / no global marker) → empty list", async () => {
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

  it("workspace scope → agents whose workspace metadata.rootWorkspaceId matches", async () => {
    workspaces.set([
      seedWorkspace("ws-in", { metadata: { rootWorkspaceId: "grp-1" } }),
      seedWorkspace("ws-out", { metadata: { rootWorkspaceId: "grp-2" } }),
      seedWorkspace("ws-none", {}),
      makeRoot("grp-1", "/work/one", ["ws-in"]),
    ] as never);
    const api = makeApi([
      makeAgent({ agentId: "a-in", workspaceId: "ws-in" }),
      makeAgent({ agentId: "a-out", workspaceId: "ws-out" }),
      makeAgent({ agentId: "a-none", workspaceId: "ws-none" }),
    ]);
    const host: DashboardHostContext = {
      metadata: { rootWorkspaceId: "grp-1" },
    };
    const store = hostScopedAgentsStore(api, host);
    await tick();
    expect(get(store).map((a) => a.agentId)).toEqual(["a-in"]);
  });

  it("workspace scope → includes unclaimed workspaces whose CWD falls under workspace.path", async () => {
    workspaces.set([
      seedWorkspace("ws-under", { cwd: "/work/one/sub" }),
      seedWorkspace("ws-elsewhere", { cwd: "/other/path" }),
      makeRoot("grp-1", "/work/one"),
    ] as never);
    const api = makeApi([
      makeAgent({ agentId: "a-under", workspaceId: "ws-under" }),
      makeAgent({ agentId: "a-else", workspaceId: "ws-elsewhere" }),
    ]);
    const host: DashboardHostContext = {
      metadata: { rootWorkspaceId: "grp-1" },
    };
    const store = hostScopedAgentsStore(api, host);
    await tick();
    expect(get(store).map((a) => a.agentId)).toEqual(["a-under"]);
  });

  it("workspace scope → excludes claimed workspaces even when CWD matches (they belong to another owner)", async () => {
    workspaces.set([
      {
        ...seedWorkspace("ws-under", { cwd: "/work/one/sub" }),
        rootWorkspaceId: "someone-else",
      },
      makeRoot("grp-1", "/work/one"),
    ] as never);
    claimWorkspace("ws-under", "someone-else");
    const api = makeApi([
      makeAgent({ agentId: "a-under", workspaceId: "ws-under" }),
    ]);
    const host: DashboardHostContext = {
      metadata: { rootWorkspaceId: "grp-1" },
    };
    const store = hostScopedAgentsStore(api, host);
    await tick();
    expect(get(store)).toEqual([]);
  });

  it("workspace scope → prefix-only match: sibling paths don't leak in", async () => {
    workspaces.set([
      seedWorkspace("ws-sibling", { cwd: "/work/one-other/sub" }),
      makeRoot("grp-1", "/work/one"),
    ] as never);
    const api = makeApi([
      makeAgent({ agentId: "a-sib", workspaceId: "ws-sibling" }),
    ]);
    const host: DashboardHostContext = {
      metadata: { rootWorkspaceId: "grp-1" },
    };
    const store = hostScopedAgentsStore(api, host);
    await tick();
    expect(get(store)).toEqual([]);
  });

  it("workspace scope → includes workspace in workspace.branchedWorkspaceIds even when claimed and no metadata.rootWorkspaceId", async () => {
    // Regression test: promote-to-workspace calls addChildToWorkspace + claimWorkspace
    // but does NOT stamp metadata.rootWorkspaceId. Without criterion 2 in hostScopedAgentsStore,
    // the claim guard ($claimedIds.has) would block the CWD fallback and the agent
    // would be invisible in the workspace's Kanban dashboard.
    workspaces.set([
      {
        ...seedWorkspace("ws-native", { cwd: "" }), // no cwd, no metadata.rootWorkspaceId
        rootWorkspaceId: "grp-1",
      },
      makeRoot("grp-1", "/work/one", ["ws-native"]),
    ] as never);
    // Simulate the claim that promote-to-workspace installs.
    claimWorkspace("ws-native", "core");
    const api = makeApi([
      makeAgent({ agentId: "a-native", workspaceId: "ws-native" }),
    ]);
    const host: DashboardHostContext = {
      metadata: { rootWorkspaceId: "grp-1" },
    };
    const store = hostScopedAgentsStore(api, host);
    await tick();
    expect(get(store).map((a) => a.agentId)).toEqual(["a-native"]);
  });

  it("workspace scope → workspace in workspace.branchedWorkspaceIds for a different workspace is not included", async () => {
    workspaces.set([
      seedWorkspace("ws-other", { cwd: "" }),
      makeRoot("grp-1", "/work/one"),
      makeRoot("grp-2", "/work/two", ["ws-other"], "red"),
    ] as never);
    const api = makeApi([
      makeAgent({ agentId: "a-other", workspaceId: "ws-other" }),
    ]);
    const host: DashboardHostContext = {
      metadata: { rootWorkspaceId: "grp-1" },
    };
    const store = hostScopedAgentsStore(api, host);
    await tick();
    expect(get(store)).toEqual([]);
  });
});
