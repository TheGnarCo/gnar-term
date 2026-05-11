/**
 * Tests for the `get_pane_agent` MCP tool (cycle-7).
 *
 * TDD: written before implementation.
 * Tests verify that get_pane_agent returns the triple:
 *   { paneId, agentType?, agentState, intendedAgent? }
 * by reading paneAgentTypeStore + paneAgentStateStore + workspace intendedAgent.
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

vi.mock("../lib/services/spawn-helper", () => ({
  spawnAgentInWorktree: vi.fn().mockResolvedValue({
    workspace_id: "ws-1",
    pane_id: "pane-1",
    surface_id: "surf-1",
    branch: "branch-1",
    worktree_path: "/tmp/repo-branch-1",
  }),
}));

// --- agent-detection-service mock with controllable stores ---

const { paneAgentTypeStoreMock, paneAgentStateStoreMock } = vi.hoisted(() => {
  let _paneAgentType: Record<string, unknown> = {};
  let _paneAgentState: Map<string, unknown> = new Map();

  const paneAgentTypeStoreMock = {
    subscribe: (run: (v: Record<string, unknown>) => void) => {
      run(_paneAgentType);
      return () => {};
    },
    _set: (v: Record<string, unknown>) => {
      _paneAgentType = v;
    },
    _get: () => _paneAgentType,
  };
  const paneAgentStateStoreMock = {
    subscribe: (run: (v: Map<string, unknown>) => void) => {
      run(_paneAgentState);
      return () => {};
    },
    _set: (v: Map<string, unknown>) => {
      _paneAgentState = v;
    },
  };
  return { paneAgentTypeStoreMock, paneAgentStateStoreMock };
});

vi.mock("../lib/services/agent-detection-service", () => ({
  agentsStore: {
    subscribe: (run: (v: unknown[]) => void) => {
      run([]);
      return () => {};
    },
  },
  paneAgentTypeStore: paneAgentTypeStoreMock,
  paneAgentStateStore: paneAgentStateStoreMock,
}));

vi.mock("../lib/services/agent-intervention-service", () => ({
  interruptAgent: vi.fn().mockResolvedValue(true),
  killAgent: vi.fn().mockResolvedValue(true),
  sendKeysToAgent: vi.fn().mockResolvedValue(true),
}));

vi.mock("../lib/services/attention-api", () => ({
  pushExternalAttention: vi.fn(),
  attentionStore: {
    subscribe: (run: (v: unknown[]) => void) => {
      run([]);
      return () => {};
    },
  },
}));

vi.mock("../lib/services/worktree-service", () => ({
  createWorktreeWorkspaceFromConfig: vi
    .fn()
    .mockResolvedValue({ workspaceId: "ws-1" }),
  getWorktreeEntries: vi.fn().mockReturnValue([]),
  getWorktreeSettings: vi.fn().mockReturnValue({}),
}));

// ---- imports after mocks ----

import {
  dispatch,
  _resetMcpServerForTest,
  _testContext,
} from "../lib/services/mcp-server";
import { workspaces } from "../lib/stores/workspace";
import { uid } from "../lib/types";

function makeWorkspaceWithPane(intendedAgent?: string): {
  wsId: string;
  paneId: string;
} {
  const paneId = uid();
  const wsId = uid();
  const pane = {
    id: paneId,
    surfaces: [],
    activeSurfaceId: null,
    ...(intendedAgent ? { intendedAgent } : {}),
  };
  workspaces.set([
    {
      id: wsId,
      name: "Test WS",
      activePaneId: paneId,
      paneLayout: { type: "pane", pane },
    } as unknown as Parameters<typeof workspaces.set>[0][0],
  ]);
  return { wsId, paneId };
}

beforeEach(() => {
  _resetMcpServerForTest();
  workspaces.set([]);
  paneAgentTypeStoreMock._set({});
  paneAgentStateStoreMock._set(new Map());
  invokeMock.mockReset();
});

// ---------------------------------------------------------------------------
// get_pane_agent tests
// ---------------------------------------------------------------------------

describe("get_pane_agent tool", () => {
  it("happy path — returns full triple for tracked pane with detection + intendedAgent", async () => {
    const { paneId } = makeWorkspaceWithPane("claude");
    const ctx = _testContext(null);

    // Simulate detection: paneAgentTypeStore has an entry
    paneAgentTypeStoreMock._set({
      [paneId]: {
        agentType: "claude",
        confidence: "osc",
        detectedAt: new Date().toISOString(),
      },
    });

    // Simulate state: paneAgentStateStore has an entry
    paneAgentStateStoreMock._set(
      new Map([
        [
          paneId,
          {
            state: "awaiting_input",
            transitionedAt: new Date().toISOString(),
          },
        ],
      ]),
    );

    const resp = await dispatch(
      {
        jsonrpc: "2.0",
        id: 20,
        method: "tools/call",
        params: {
          name: "get_pane_agent",
          arguments: { paneId },
        },
      },
      ctx,
    );

    expect(resp).not.toBeNull();
    const r = resp as {
      result?: { content: [{ text: string }] };
      error?: unknown;
    };
    expect(r.error).toBeUndefined();
    const result = JSON.parse(r.result!.content[0].text) as {
      paneId: string;
      agentType?: string;
      agentState: string;
      intendedAgent?: string;
    };

    expect(result.paneId).toBe(paneId);
    expect(result.agentType).toBe("claude");
    expect(result.agentState).toBe("awaiting_input");
    expect(result.intendedAgent).toBe("claude");
  });

  it("edge case — agentState 'unknown' for untracked pane, intendedAgent honored", async () => {
    const { paneId } = makeWorkspaceWithPane("codex");
    const ctx = _testContext(null);

    // No entries in detection or state stores — but intendedAgent is set on the pane
    paneAgentTypeStoreMock._set({});
    paneAgentStateStoreMock._set(new Map());

    const resp = await dispatch(
      {
        jsonrpc: "2.0",
        id: 21,
        method: "tools/call",
        params: {
          name: "get_pane_agent",
          arguments: { paneId },
        },
      },
      ctx,
    );

    expect(resp).not.toBeNull();
    const r = resp as {
      result?: { content: [{ text: string }] };
      error?: unknown;
    };
    expect(r.error).toBeUndefined();
    const result = JSON.parse(r.result!.content[0].text) as {
      paneId: string;
      agentType?: string;
      agentState: string;
      intendedAgent?: string;
    };

    expect(result.paneId).toBe(paneId);
    expect(result.agentType).toBeUndefined();
    expect(result.agentState).toBe("unknown");
    expect(result.intendedAgent).toBe("codex");
  });

  it("failure path — nonexistent paneId: returns structured error", async () => {
    const ctx = _testContext(null);

    const resp = await dispatch(
      {
        jsonrpc: "2.0",
        id: 22,
        method: "tools/call",
        params: {
          name: "get_pane_agent",
          arguments: { paneId: "pane-does-not-exist-xyz" },
        },
      },
      ctx,
    );

    expect(resp).not.toBeNull();
    const r = resp as { error?: { code: number; message: string } };
    expect(r.error).toBeDefined();
    expect(r.error?.code).toBe(-32000);
    expect(r.error?.message).toMatch(/pane/i);
  });
});
