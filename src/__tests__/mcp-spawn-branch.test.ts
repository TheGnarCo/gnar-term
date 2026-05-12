/**
 * Tests for the `spawn_branch` MCP tool (cycle-7).
 *
 * TDD: written before implementation.
 * Tests verify that spawn_branch creates a Worktree Branch and optionally
 * auto-spawns an agent via the existing worktree-service + spawn_agent paths.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Tauri / transport mocks ---

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
  emit: vi.fn().mockResolvedValue(undefined),
}));

// --- spawn-helper mock ---

const { spawnAgentInWorktreeMock } = vi.hoisted(() => ({
  spawnAgentInWorktreeMock: vi.fn(),
}));

vi.mock("../lib/services/spawn-helper", async () => {
  const actual = await vi.importActual<
    typeof import("../lib/services/spawn-helper")
  >("../lib/services/spawn-helper");
  return {
    ...actual,
    spawnAgentInWorktree: spawnAgentInWorktreeMock,
  };
});

// --- agent-detection-service mock (needed by mcp-server imports) ---

const { agentsStoreMock, paneAgentTypeStoreMock, paneAgentStateStoreMock } =
  vi.hoisted(() => {
    const _agents: unknown[] = [];
    let _paneAgentType: Record<string, unknown> = {};
    let _paneAgentState: Map<string, unknown> = new Map();

    const makeReadable = <T>(
      getValue: () => T,
    ): { subscribe: (run: (v: T) => void) => () => void } => ({
      subscribe: (run: (v: T) => void) => {
        run(getValue());
        return () => {};
      },
    });

    const agentsStoreMock = makeReadable(() => _agents);
    const paneAgentTypeStoreMock = {
      ...makeReadable(() => _paneAgentType),
      _set: (v: Record<string, unknown>) => {
        _paneAgentType = v;
      },
    };
    const paneAgentStateStoreMock = {
      ...makeReadable(() => _paneAgentState),
      _set: (v: Map<string, unknown>) => {
        _paneAgentState = v;
      },
    };

    return { agentsStoreMock, paneAgentTypeStoreMock, paneAgentStateStoreMock };
  });

vi.mock("../lib/services/agent-detection-service", () => ({
  agentsStore: agentsStoreMock,
  paneAgentTypeStore: paneAgentTypeStoreMock,
  paneAgentStateStore: paneAgentStateStoreMock,
}));

vi.mock("../lib/services/agent-intervention-service", () => ({
  interruptAgent: vi.fn().mockResolvedValue(true),
  killAgent: vi.fn().mockResolvedValue(true),
  sendKeysToAgent: vi.fn().mockResolvedValue(true),
}));

// --- attention-api mock (cycle-5 dep) ---

const { pushExternalAttentionMock } = vi.hoisted(() => ({
  pushExternalAttentionMock: vi.fn(),
}));

vi.mock("../lib/services/attention-api", () => ({
  pushExternalAttention: pushExternalAttentionMock,
  attentionStore: {
    subscribe: (run: (v: unknown[]) => void) => {
      run([]);
      return () => {};
    },
  },
}));

// --- worktree-service mock ---

const { createWorktreeWorkspaceFromConfigMock } = vi.hoisted(() => ({
  createWorktreeWorkspaceFromConfigMock: vi.fn(),
}));

vi.mock("../lib/services/worktree-service", () => ({
  createWorktreeWorkspaceFromConfig: createWorktreeWorkspaceFromConfigMock,
  getWorktreeEntries: vi.fn().mockReturnValue([]),
  getWorktreeSettings: vi.fn().mockReturnValue({}),
}));

// --- config mock — controls AgentPreset[] visible to spawn_branch ---

const { getConfigMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn<() => Record<string, unknown>>().mockReturnValue({}),
}));

vi.mock("../lib/config", () => ({
  getConfig: getConfigMock,
}));

// ---- imports after mocks ----

import {
  dispatch,
  _resetMcpServerForTest,
  _testContext,
} from "../lib/services/mcp-server";

// ---- workspace helpers ----

import { workspaces } from "../lib/stores/workspace";
import { uid } from "../lib/types";

function makeWorkspace(overrides: Record<string, unknown> = {}) {
  const paneId = uid();
  const ws = {
    id: uid(),
    name: "Test WS",
    activePaneId: paneId,
    paneLayout: {
      type: "pane" as const,
      pane: {
        id: paneId,
        surfaces: [],
        activeSurfaceId: null,
      },
    },
    locked: false,
    ...overrides,
  };
  workspaces.set([ws as unknown as Parameters<typeof workspaces.set>[0][0]]);
  return ws;
}

beforeEach(() => {
  _resetMcpServerForTest();
  workspaces.set([]);
  spawnAgentInWorktreeMock.mockReset();
  createWorktreeWorkspaceFromConfigMock.mockReset();
  pushExternalAttentionMock.mockReset();
  getConfigMock.mockReset().mockReturnValue({});
});

// ---------------------------------------------------------------------------
// spawn_branch tests
// ---------------------------------------------------------------------------

describe("spawn_branch tool", () => {
  it("happy path — no agent: creates worktree branch, returns branchId/worktreePath, agentSpawned false", async () => {
    const ws = makeWorkspace();
    const ctx = _testContext({ workspaceId: ws.id });

    createWorktreeWorkspaceFromConfigMock.mockResolvedValue({
      workspaceId: "wt-ws-1",
    });

    // The tool needs a pane to exist in the new workspace
    const newPaneId = uid();
    // Set up the workspaces store so the new workspace exists after creation
    createWorktreeWorkspaceFromConfigMock.mockImplementation(async () => {
      const newWs = {
        id: "wt-ws-1",
        name: "my-feature",
        activePaneId: newPaneId,
        paneLayout: {
          type: "pane" as const,
          pane: { id: newPaneId, surfaces: [], activeSurfaceId: null },
        },
      };
      workspaces.update((l) => [...l, newWs as unknown as (typeof l)[0]]);
      return { workspaceId: "wt-ws-1" };
    });

    const resp = await dispatch(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "spawn_branch",
          arguments: {
            name: "my-feature",
            base: "main",
            repoPath: "/Users/test/repos/my-repo",
          },
        },
      },
      ctx,
    );

    expect(resp).not.toBeNull();
    const r = resp as { result: { content: [{ text: string }] } };
    const result = JSON.parse(r.result.content[0].text) as {
      branchId: string;
      worktreePath: string;
      agentSpawned: boolean;
    };

    expect(result.agentSpawned).toBe(false);
    expect(typeof result.branchId).toBe("string");
    expect(result.branchId.length).toBeGreaterThan(0);
    expect(typeof result.worktreePath).toBe("string");
  });

  it("happy path — with agent: creates worktree and spawns agent, agentSpawned true", async () => {
    const ws = makeWorkspace();
    const ctx = _testContext({ workspaceId: ws.id });

    spawnAgentInWorktreeMock.mockResolvedValue({
      workspace_id: "wt-ws-2",
      pane_id: "wt-pane-2",
      surface_id: "wt-surf-2",
      branch: "my-agent-branch",
      worktree_path: "/tmp/repos/my-repo-my-agent-branch",
    });

    const resp = await dispatch(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "spawn_branch",
          arguments: {
            name: "my-feature",
            base: "main",
            repoPath: "/Users/test/repos/my-repo",
            agent: {
              type: "claude-code",
              initialPrompt: "Fix the bug",
            },
          },
        },
      },
      ctx,
    );

    expect(resp).not.toBeNull();
    const r = resp as { result: { content: [{ text: string }] } };
    const result = JSON.parse(r.result.content[0].text) as {
      branchId: string;
      worktreePath: string;
      agentSpawned: boolean;
    };

    expect(result.agentSpawned).toBe(true);
    expect(spawnAgentInWorktreeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "my-feature",
        agent: "claude-code",
        repoPath: "/Users/test/repos/my-repo",
        branch: "my-feature",
        base: "main",
        taskContext: "Fix the bug",
      }),
    );
  });

  it("forwards explicit agent.command and trims/normalizes branch + base", async () => {
    const ws = makeWorkspace();
    const ctx = _testContext({ workspaceId: ws.id });

    spawnAgentInWorktreeMock.mockResolvedValue({
      workspace_id: "wt-cmd-ws",
      pane_id: "wt-cmd-pane",
      surface_id: "wt-cmd-surf",
      branch: "weekly-cleanup",
      worktree_path: "/repos/x-weekly-cleanup",
    });

    const resp = await dispatch(
      {
        jsonrpc: "2.0",
        id: 42,
        method: "tools/call",
        params: {
          name: "spawn_branch",
          arguments: {
            name: "  weekly cleanup  ",
            base: "  dev  ",
            repoPath: "/repos/x",
            agent: {
              type: "custom",
              command: "./scripts/run-bot.sh --once",
              initialPrompt: "Run the nightly bot",
            },
          },
        },
      },
      ctx,
    );

    expect(resp).not.toBeNull();
    expect(spawnAgentInWorktreeMock).toHaveBeenCalledTimes(1);
    // Whitespace in name collapses to hyphens for the branch; base is trimmed.
    // Explicit agent.command forwards verbatim — even for type "custom".
    expect(spawnAgentInWorktreeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "weekly cleanup",
        agent: "custom",
        command: "./scripts/run-bot.sh --once",
        taskContext: "Run the nightly bot",
        repoPath: "/repos/x",
        branch: "weekly-cleanup",
        base: "dev",
      }),
    );
  });

  it("resolves agent_preset_name from config.agents[] (known intendedAgent → mapped SpawnAgentType)", async () => {
    const ws = makeWorkspace();
    const ctx = _testContext({ workspaceId: ws.id });

    getConfigMock.mockReturnValue({
      agents: [
        {
          name: "Feature Work",
          command: "claude --model opus",
          env: { CLAUDE_MODEL: "opus" },
          intendedAgent: "claude",
          initialPrompt: "Land feature X",
        },
      ],
    });

    spawnAgentInWorktreeMock.mockResolvedValue({
      workspace_id: "wt-ws-3",
      pane_id: "wt-pane-3",
      surface_id: "wt-surf-3",
      branch: "feature-work",
      worktree_path: "/repos/test-feature-work",
    });

    const resp = await dispatch(
      {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: {
          name: "spawn_branch",
          arguments: {
            name: "feature-work",
            repoPath: "/repos/test",
            agent_preset_name: "Feature Work",
          },
        },
      },
      ctx,
    );

    expect(resp).not.toBeNull();
    const r = resp as { result: { content: [{ text: string }] } };
    const result = JSON.parse(r.result.content[0].text) as {
      agentSpawned: boolean;
    };
    expect(result.agentSpawned).toBe(true);

    // intendedAgent "claude" maps to SpawnAgentType "claude-code"; preset.command
    // becomes the literal command override; initialPrompt → taskContext; env passthrough.
    expect(spawnAgentInWorktreeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code",
        command: "claude --model opus",
        taskContext: "Land feature X",
        env: { CLAUDE_MODEL: "opus" },
      }),
    );
  });

  it("resolves agent_preset_name with unknown intendedAgent → falls back to custom", async () => {
    const ws = makeWorkspace();
    const ctx = _testContext({ workspaceId: ws.id });

    getConfigMock.mockReturnValue({
      agents: [
        {
          name: "Bespoke",
          command: "./my-bespoke-runner --flag",
        },
      ],
    });

    spawnAgentInWorktreeMock.mockResolvedValue({
      workspace_id: "wt-ws-4",
      pane_id: "wt-pane-4",
      surface_id: "wt-surf-4",
      branch: "bespoke",
      worktree_path: "/repos/test-bespoke",
    });

    await dispatch(
      {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: {
          name: "spawn_branch",
          arguments: {
            name: "bespoke",
            repoPath: "/repos/test",
            agent_preset_name: "Bespoke",
          },
        },
      },
      ctx,
    );

    expect(spawnAgentInWorktreeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "custom",
        command: "./my-bespoke-runner --flag",
      }),
    );
  });

  it("explicit agent arg wins over agent_preset_name when both are passed", async () => {
    const ws = makeWorkspace();
    const ctx = _testContext({ workspaceId: ws.id });

    getConfigMock.mockReturnValue({
      agents: [
        {
          name: "Should Be Ignored",
          command: "ignored",
          intendedAgent: "aider",
        },
      ],
    });

    spawnAgentInWorktreeMock.mockResolvedValue({
      workspace_id: "wt-ws-5",
      pane_id: "wt-pane-5",
      surface_id: "wt-surf-5",
      branch: "explicit",
      worktree_path: "/repos/test-explicit",
    });

    await dispatch(
      {
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: {
          name: "spawn_branch",
          arguments: {
            name: "explicit",
            repoPath: "/repos/test",
            agent: { type: "codex", initialPrompt: "winning prompt" },
            agent_preset_name: "Should Be Ignored",
          },
        },
      },
      ctx,
    );

    expect(spawnAgentInWorktreeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "codex",
        taskContext: "winning prompt",
      }),
    );
    // Preset's command must NOT have leaked through.
    const call = spawnAgentInWorktreeMock.mock.calls[0]?.[0] as {
      command?: string;
    };
    expect(call?.command).toBeUndefined();
  });

  it("agent_preset_name not found in config → structured error", async () => {
    const ws = makeWorkspace();
    const ctx = _testContext({ workspaceId: ws.id });

    getConfigMock.mockReturnValue({
      agents: [{ name: "Other", command: "x" }],
    });

    const resp = await dispatch(
      {
        jsonrpc: "2.0",
        id: 13,
        method: "tools/call",
        params: {
          name: "spawn_branch",
          arguments: {
            name: "feature",
            repoPath: "/repos/test",
            agent_preset_name: "Missing",
          },
        },
      },
      ctx,
    );

    const r = resp as { error?: { code: number; message: string } };
    expect(r.error).toBeDefined();
    expect(r.error?.message).toMatch(/preset.*Missing/i);
  });

  it("failure path — missing name: returns structured error", async () => {
    const ws = makeWorkspace();
    const ctx = _testContext({ workspaceId: ws.id });

    const resp = await dispatch(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "spawn_branch",
          arguments: {
            // name is missing
            base: "main",
          },
        },
      },
      ctx,
    );

    expect(resp).not.toBeNull();
    const r = resp as { error?: { code: number; message: string } };
    expect(r.error).toBeDefined();
    expect(r.error?.code).toBe(-32000);
    expect(r.error?.message).toMatch(/name/i);
  });
});
