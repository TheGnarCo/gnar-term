/**
 * Tests for the `emit_attention` MCP tool (cycle-7).
 *
 * TDD: written before implementation.
 * Tests verify that emit_attention pushes typed events into the Attention API.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";

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
  resolveAgentPresetForSpawn: vi.fn().mockReturnValue(null),
  deriveWorktreePath: vi.fn().mockReturnValue("/tmp/repo-branch-1"),
  SPAWN_AGENT_TYPES: ["claude-code", "codex", "aider", "custom"] as const,
}));

// --- agent-detection-service mock ---

vi.mock("../lib/services/agent-detection-service", () => ({
  agentsStore: {
    subscribe: (run: (v: unknown[]) => void) => {
      run([]);
      return () => {};
    },
  },
  paneAgentTypeStore: {
    subscribe: (run: (v: unknown) => void) => {
      run({});
      return () => {};
    },
  },
  paneAgentStateStore: {
    subscribe: (run: (v: unknown) => void) => {
      run(new Map());
      return () => {};
    },
  },
}));

vi.mock("../lib/services/agent-intervention-service", () => ({
  interruptAgent: vi.fn().mockResolvedValue(true),
  killAgent: vi.fn().mockResolvedValue(true),
  sendKeysToAgent: vi.fn().mockResolvedValue(true),
}));

vi.mock("../lib/services/worktree-service", () => ({
  createWorktreeWorkspaceFromConfig: vi
    .fn()
    .mockResolvedValue({ workspaceId: "ws-1" }),
  getWorktreeEntries: vi.fn().mockReturnValue([]),
  getWorktreeSettings: vi.fn().mockReturnValue({}),
}));

// pane-lookup is consulted by emit_attention to validate paneId. Default
// behaviour for these tests: pretend every paneId refers to a known pane;
// individual tests can override paneExists to exercise the failure path.
const paneExistsMock = vi.fn().mockReturnValue(true);
vi.mock("../lib/services/pane-lookup", () => ({
  paneExists: (...args: unknown[]) => paneExistsMock(...args),
  lookupPaneIntendedAgent: vi.fn().mockReturnValue(null),
}));

// --- Real attention-api: we want to test actual store writes ---
// (no mock here — we import the real module)

import {
  dispatch,
  _resetMcpServerForTest,
  _testContext,
} from "../lib/services/mcp-server";
import {
  attentionStore,
  resetAttentionApiForTests,
} from "../lib/services/attention-api";

beforeEach(() => {
  _resetMcpServerForTest();
  resetAttentionApiForTests();
  invokeMock.mockReset();
  paneExistsMock.mockReset();
  paneExistsMock.mockReturnValue(true);
});

// ---------------------------------------------------------------------------
// emit_attention tests
// ---------------------------------------------------------------------------

describe("emit_attention tool", () => {
  it("happy path — pushes event to attentionStore with correct shape", async () => {
    const ctx = _testContext(null);

    const resp = await dispatch(
      {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: {
          name: "emit_attention",
          arguments: {
            paneId: "pane-abc",
            kind: "awaiting_input",
            title: "Agent needs input",
            body: "Please respond to the prompt",
          },
        },
      },
      ctx,
    );

    // Tool should succeed
    expect(resp).not.toBeNull();
    const r = resp as {
      result?: { content: [{ text: string }] };
      error?: unknown;
    };
    expect(r.error).toBeUndefined();
    const result = JSON.parse(r.result!.content[0].text) as {
      ok: boolean;
      eventId: string;
    };
    expect(result.ok).toBe(true);
    expect(typeof result.eventId).toBe("string");
    expect(result.eventId.length).toBeGreaterThan(0);

    // Event should appear in attentionStore
    const events = get(attentionStore);
    const ev = events.find((e) => e.paneId === "pane-abc");
    expect(ev).toBeDefined();
    expect(ev?.kind).toBe("awaiting_input");
    expect(ev?.title).toBe("Agent needs input");
    expect(ev?.body).toBe("Please respond to the prompt");
    expect(ev?.source).toBe("external");
  });

  it("happy path — notify kind works", async () => {
    const ctx = _testContext(null);

    await dispatch(
      {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: {
          name: "emit_attention",
          arguments: {
            paneId: "pane-xyz",
            kind: "notify",
            title: "Build complete",
          },
        },
      },
      ctx,
    );

    const events = get(attentionStore).filter((e) => e.paneId === "pane-xyz");
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.kind).toBe("notify");
  });

  it("failure path — unknown paneId: returns structured error", async () => {
    const ctx = _testContext(null);
    paneExistsMock.mockReturnValue(false);

    const resp = await dispatch(
      {
        jsonrpc: "2.0",
        id: 13,
        method: "tools/call",
        params: {
          name: "emit_attention",
          arguments: {
            paneId: "pane-nope",
            kind: "notify",
          },
        },
      },
      ctx,
    );

    expect(resp).not.toBeNull();
    const r = resp as { error?: { code: number; message: string } };
    expect(r.error).toBeDefined();
    expect(r.error?.code).toBe(-32000);
    expect(r.error?.message).toMatch(/does not match any known pane/i);
  });

  it("failure path — missing paneId: returns structured error", async () => {
    const ctx = _testContext(null);

    const resp = await dispatch(
      {
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: {
          name: "emit_attention",
          arguments: {
            // paneId missing
            kind: "notify",
          },
        },
      },
      ctx,
    );

    expect(resp).not.toBeNull();
    const r = resp as { error?: { code: number; message: string } };
    expect(r.error).toBeDefined();
    expect(r.error?.code).toBe(-32000);
    expect(r.error?.message).toMatch(/paneId/i);
  });
});
