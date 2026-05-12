import { describe, it, expect, vi, beforeEach } from "vitest";
import { writable } from "svelte/store";
import type {
  ExtensionAPI,
  AgentRef,
  PaneRef,
  WorkspaceActionContext,
} from "../../api";
import { registerWorkspaceActions } from "../contributions/register-workspace-actions";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

function makeAgent(paneId: string): AgentRef {
  return {
    agentId: "agent-1",
    agentName: "Test Agent",
    surfaceId: "surface-1",
    paneId,
    workspaceId: "ws-a",
    status: "running",
    createdAt: new Date().toISOString(),
    lastStatusChange: new Date().toISOString(),
  };
}

interface RegisteredAction {
  id: string;
  label: string;
  zone?: string;
  handler: (ctx: WorkspaceActionContext) => void | Promise<void>;
  when?: (ctx: WorkspaceActionContext) => boolean;
}

function makeFakeApi(
  agentByPane: Map<string, AgentRef | null> = new Map(),
  activePaneValue: PaneRef | null = null,
) {
  const actions: RegisteredAction[] = [];
  const agentPresets = writable([]);
  const activePane = writable<PaneRef | null>(activePaneValue);
  const getActiveCwd = vi.fn().mockResolvedValue("/home/user/repo");
  const showFormPrompt = vi.fn().mockResolvedValue(null);
  const invoke = vi.fn().mockResolvedValue(undefined);
  const createWorkspaceFromDef = vi.fn().mockResolvedValue("ws-new");
  const reportError = vi.fn();

  const api = {
    agentPresets,
    activePane,
    getActiveCwd,
    showFormPrompt,
    invoke,
    createWorkspaceFromDef,
    reportError,
    registerWorkspaceAction: vi.fn(
      (
        id: string,
        opts: {
          label: string;
          zone?: string;
          handler: (ctx: WorkspaceActionContext) => void | Promise<void>;
          when?: (ctx: WorkspaceActionContext) => boolean;
        },
      ) => {
        actions.push({ id, ...opts });
      },
    ),
    getWorkspaceActions: () => actions,
    getAgentByPane: vi.fn((paneId: string) => agentByPane.get(paneId) ?? null),
  } as unknown as ExtensionAPI;

  return {
    api,
    actions,
    showFormPrompt,
    getAgentByPane: api.getAgentByPane,
    activePane,
  };
}

function makePane(id: string): PaneRef {
  return { id, surfaces: [], activeSurfaceId: null };
}

describe("registerWorkspaceActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers both workspace actions", () => {
    const { api, actions } = makeFakeApi();
    registerWorkspaceActions(api);
    const ids = actions.map((a) => a.id);
    expect(ids).toContain("spawn-agentic-branch");
    expect(ids).toContain("boot-agent-here");
  });

  it("spawn-agentic-branch has zone 'workspace-tile'", () => {
    const { api, actions } = makeFakeApi();
    registerWorkspaceActions(api);
    const action = actions.find((a) => a.id === "spawn-agentic-branch")!;
    expect(action.zone).toBe("workspace-tile");
  });

  it("boot-agent-here has zone 'workspace'", () => {
    const { api, actions } = makeFakeApi();
    registerWorkspaceActions(api);
    const action = actions.find((a) => a.id === "boot-agent-here")!;
    expect(action.zone).toBe("workspace");
  });

  describe("boot-agent-here when predicate", () => {
    it("returns true when pane has no agent (via paneId)", () => {
      const { api, actions } = makeFakeApi(
        new Map([["pane-without-agent", null]]),
      );
      registerWorkspaceActions(api);
      const action = actions.find((a) => a.id === "boot-agent-here")!;
      expect(action.when!({ paneId: "pane-without-agent" })).toBe(true);
    });

    it("returns false when pane has an agent (via paneId)", () => {
      const paneId = "pane-with-agent";
      const agentMap = new Map([[paneId, makeAgent(paneId)]]);
      const { api, actions } = makeFakeApi(agentMap);
      registerWorkspaceActions(api);
      const action = actions.find((a) => a.id === "boot-agent-here")!;
      expect(action.when!({ paneId })).toBe(false);
    });

    it("returns true when pane has no agent (via activePaneId)", () => {
      const { api, actions } = makeFakeApi(new Map([["pane-x", null]]));
      registerWorkspaceActions(api);
      const action = actions.find((a) => a.id === "boot-agent-here")!;
      expect(action.when!({ activePaneId: "pane-x" })).toBe(true);
    });

    it("returns false when pane has an agent (via activePaneId)", () => {
      const paneId = "pane-y";
      const agentMap = new Map([[paneId, makeAgent(paneId)]]);
      const { api, actions } = makeFakeApi(agentMap);
      registerWorkspaceActions(api);
      const action = actions.find((a) => a.id === "boot-agent-here")!;
      expect(action.when!({ activePaneId: paneId })).toBe(false);
    });

    it("falls back to api.activePane when ctx has no pane id", () => {
      const paneId = "global-active-pane";
      const { api, actions } = makeFakeApi(
        new Map([[paneId, null]]),
        makePane(paneId),
      );
      registerWorkspaceActions(api);
      const action = actions.find((a) => a.id === "boot-agent-here")!;
      // ctx empty, but globally-active pane has no agent → action visible
      expect(action.when!({})).toBe(true);
    });

    it("falls back to api.activePane and hides when that pane has an agent", () => {
      const paneId = "global-active-pane";
      const { api, actions } = makeFakeApi(
        new Map([[paneId, makeAgent(paneId)]]),
        makePane(paneId),
      );
      registerWorkspaceActions(api);
      const action = actions.find((a) => a.id === "boot-agent-here")!;
      expect(action.when!({})).toBe(false);
    });

    it("hides when no pane context AND no globally-active pane", () => {
      const { api, actions } = makeFakeApi();
      registerWorkspaceActions(api);
      const action = actions.find((a) => a.id === "boot-agent-here")!;
      // No ctx pane, no api.activePane — hide the action (nothing to boot into)
      expect(action.when!({})).toBe(false);
    });
  });

  describe("spawn-agentic-branch handler", () => {
    it("triggers api.showFormPrompt when invoked", async () => {
      const { api, actions, showFormPrompt } = makeFakeApi();
      registerWorkspaceActions(api);
      const action = actions.find((a) => a.id === "spawn-agentic-branch")!;
      await action.handler({});
      expect(showFormPrompt).toHaveBeenCalledTimes(1);
    });
  });
});
