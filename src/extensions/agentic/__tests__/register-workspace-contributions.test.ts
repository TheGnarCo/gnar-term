import { describe, it, expect, vi } from "vitest";
import { writable } from "svelte/store";
import type { ExtensionAPI, AgentRef } from "../../api";
import { registerWorkspaceContributions } from "../contributions/register-workspace-contributions";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

function makeAgent(overrides: Partial<AgentRef> = {}): AgentRef {
  return {
    agentId: "agent-1",
    agentName: "My Agent",
    surfaceId: "surface-1",
    paneId: "pane-1",
    workspaceId: "ws-a",
    status: "running",
    createdAt: new Date().toISOString(),
    lastStatusChange: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Build a minimal fake API that captures registrations.
 *
 * The contributor function passed to `registerChildRowContributor` is stored
 * so tests can invoke it directly (simulating a re-emission from
 * childRowContributors).
 *
 * The renderer passed to `registerRootRowRenderer` is stored so tests can
 * assert `getRootRowRenderer` returns it.
 */
function makeFakeApi(agents: AgentRef[] = []) {
  const agentsStore = writable<AgentRef[]>(agents);

  // Captured registrations
  let capturedContribute:
    | ((parentId: string) => Array<{ kind: string; id: string }>)
    | undefined;
  let capturedRenderer: { kind: string; component: unknown } | undefined;

  const registerWorkspaceSubtitle = vi.fn();
  const registerChildRowContributor = vi.fn(
    (
      _parentType: string,
      contribute: (id: string) => Array<{ kind: string; id: string }>,
    ) => {
      capturedContribute = contribute;
    },
  );
  const registerRootRowRenderer = vi.fn((kind: string, component: unknown) => {
    capturedRenderer = { kind, component };
  });

  const api = {
    agents: agentsStore,
    registerWorkspaceSubtitle,
    registerChildRowContributor,
    registerRootRowRenderer,
    getRootRowRenderer: (kind: string) =>
      capturedRenderer?.kind === kind
        ? { component: capturedRenderer.component }
        : undefined,
  } as unknown as ExtensionAPI;

  return {
    api,
    agentsStore,
    registerWorkspaceSubtitle,
    registerChildRowContributor,
    registerRootRowRenderer,
    getContribute: () => capturedContribute,
  };
}

describe("registerWorkspaceContributions", () => {
  it("registers a workspace subtitle component", () => {
    const { api, registerWorkspaceSubtitle } = makeFakeApi();
    registerWorkspaceContributions(api);
    expect(registerWorkspaceSubtitle).toHaveBeenCalledTimes(1);
    // Component should be non-null (the actual Svelte component object)
    expect(registerWorkspaceSubtitle.mock.calls[0][0]).toBeTruthy();
  });

  it("registers a child-row contributor for the 'workspace' parent type", () => {
    const { api, registerChildRowContributor } = makeFakeApi();
    registerWorkspaceContributions(api);
    expect(registerChildRowContributor).toHaveBeenCalledTimes(1);
    expect(registerChildRowContributor.mock.calls[0][0]).toBe("workspace");
  });

  it("contributor returns one agent-row per active agent in the workspace", () => {
    const { api, getContribute } = makeFakeApi([
      makeAgent({ agentId: "a1", workspaceId: "ws-a", status: "running" }),
      makeAgent({
        agentId: "a2",
        workspaceId: "ws-a",
        status: "awaiting_input",
      }),
    ]);
    registerWorkspaceContributions(api);

    const contribute = getContribute()!;
    const rows = contribute("ws-a");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ kind: "agent-row", id: "a1" });
    expect(rows[1]).toEqual({ kind: "agent-row", id: "a2" });
  });

  it("contributor excludes agents from other workspaces", () => {
    const { api, getContribute } = makeFakeApi([
      makeAgent({ agentId: "a1", workspaceId: "ws-a", status: "running" }),
      makeAgent({ agentId: "b1", workspaceId: "ws-b", status: "running" }),
    ]);
    registerWorkspaceContributions(api);

    const contribute = getContribute()!;
    const rows = contribute("ws-a");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("a1");
  });

  it("contributor excludes terminal-status agents", () => {
    const { api, getContribute } = makeFakeApi([
      makeAgent({ agentId: "a1", workspaceId: "ws-a", status: "running" }),
      makeAgent({ agentId: "a2", workspaceId: "ws-a", status: "errored" }),
      makeAgent({ agentId: "a3", workspaceId: "ws-a", status: "completed" }),
    ]);
    registerWorkspaceContributions(api);

    const contribute = getContribute()!;
    const rows = contribute("ws-a");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("a1");
  });

  it("contributor reads the live store — adding an agent is reflected immediately", () => {
    const { api, agentsStore, getContribute } = makeFakeApi([
      makeAgent({ agentId: "a1", workspaceId: "ws-a", status: "running" }),
      makeAgent({ agentId: "a2", workspaceId: "ws-a", status: "running" }),
    ]);
    registerWorkspaceContributions(api);

    const contribute = getContribute()!;
    expect(contribute("ws-a")).toHaveLength(2);

    // Add a third agent to the live store.
    agentsStore.update((prev) => [
      ...prev,
      makeAgent({ agentId: "a3", workspaceId: "ws-a", status: "running" }),
    ]);

    // Re-invoke the contributor — should see 3 rows now.
    expect(contribute("ws-a")).toHaveLength(3);
  });

  it("contributor returns empty array when no agents match", () => {
    const { api, getContribute } = makeFakeApi([]);
    registerWorkspaceContributions(api);

    const contribute = getContribute()!;
    expect(contribute("ws-a")).toEqual([]);
  });

  it("registers the 'agent-row' renderer", () => {
    const { api, registerRootRowRenderer } = makeFakeApi();
    registerWorkspaceContributions(api);
    expect(registerRootRowRenderer).toHaveBeenCalledTimes(1);
    expect(registerRootRowRenderer.mock.calls[0][0]).toBe("agent-row");
    // Component should be non-null (the actual Svelte component object)
    expect(registerRootRowRenderer.mock.calls[0][1]).toBeTruthy();
  });

  it("getRootRowRenderer returns the agent-row entry after registration", () => {
    const { api } = makeFakeApi();
    registerWorkspaceContributions(api);
    const renderer = api.getRootRowRenderer("agent-row");
    expect(renderer).toBeDefined();
    expect(renderer!.component).toBeTruthy();
  });
});
