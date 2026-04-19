/**
 * Session Log — tests for session history in the agent registry.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  initRegistry,
  registerAgent,
  unregisterAgent,
  getAgents,
  getSessionLog,
  resetRegistry,
  type DetectedAgent,
} from "../extensions/agentic-orchestrator/agent-registry";

// Minimal mock of ExtensionAPI for initRegistry
function mockApi() {
  const state = new Map<string, unknown>();
  return {
    state: {
      get: <T>(key: string) => state.get(key) as T | undefined,
      set: (key: string, value: unknown) => state.set(key, value),
    },
  } as unknown as import("../extensions/api").ExtensionAPI;
}

describe("Session Log", () => {
  beforeEach(() => {
    resetRegistry();
    const api = mockApi();
    initRegistry(api);
  });

  it("getSessionLog starts empty", () => {
    expect(getSessionLog()).toEqual([]);
  });

  it("records an entry when an agent is unregistered", () => {
    const instance: DetectedAgent = {
      agentId: "a1",
      agentName: "Claude Code",
      surfaceId: "s1",
      workspaceId: "ws1",
      status: "running",
      createdAt: "2026-01-01T00:00:00Z",
      lastStatusChange: "2026-01-01T00:00:00Z",
    };
    registerAgent(instance);
    unregisterAgent("a1");

    const log = getSessionLog();
    expect(log).toHaveLength(1);
    expect(log[0].agentId).toBe("a1");
    expect(log[0].agentName).toBe("Claude Code");
    expect(log[0].closedAt).toBeDefined();
  });

  it("keeps active agents separate from session log", () => {
    const a1: DetectedAgent = {
      agentId: "a1",
      agentName: "Claude Code",
      surfaceId: "s1",
      workspaceId: "ws1",
      status: "running",
      createdAt: "2026-01-01T00:00:00Z",
      lastStatusChange: "2026-01-01T00:00:00Z",
    };
    const a2: DetectedAgent = {
      agentId: "a2",
      agentName: "Aider",
      surfaceId: "s2",
      workspaceId: "ws1",
      status: "idle",
      createdAt: "2026-01-01T00:01:00Z",
      lastStatusChange: "2026-01-01T00:01:00Z",
    };

    registerAgent(a1);
    registerAgent(a2);
    unregisterAgent("a1");

    expect(getAgents()).toHaveLength(1);
    expect(getAgents()[0].agentId).toBe("a2");
    expect(getSessionLog()).toHaveLength(1);
    expect(getSessionLog()[0].agentId).toBe("a1");
  });

  it("limits session log to 50 entries", () => {
    for (let i = 0; i < 55; i++) {
      const instance: DetectedAgent = {
        agentId: `a${i}`,
        agentName: `Agent ${i}`,
        surfaceId: `s${i}`,
        workspaceId: "ws1",
        status: "idle",
        createdAt: "2026-01-01T00:00:00Z",
        lastStatusChange: "2026-01-01T00:00:00Z",
      };
      registerAgent(instance);
      unregisterAgent(`a${i}`);
    }

    const log = getSessionLog();
    expect(log.length).toBeLessThanOrEqual(50);
    // Most recent entry should be the last one added
    expect(log[0].agentId).toBe("a54");
  });
});
