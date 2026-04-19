/**
 * Tests for the agent registry — centralized detected agent tracking.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  initRegistry,
  generateAgentId,
  registerAgent,
  unregisterAgent,
  updateAgentStatus,
  getAgents,
  resetRegistry,
  type DetectedAgent,
} from "../extensions/agentic-orchestrator/agent-registry";
import type { ExtensionAPI } from "../extensions/api";

function createMockApi(): ExtensionAPI {
  const store = new Map<string, unknown>();
  return {
    state: {
      get<T>(key: string): T | undefined {
        return store.get(key) as T | undefined;
      },
      set<T>(key: string, value: T): void {
        store.set(key, value);
      },
    },
  } as unknown as ExtensionAPI;
}

function makeInstance(overrides: Partial<DetectedAgent> = {}): DetectedAgent {
  return {
    agentId: overrides.agentId ?? "test-agent-1",
    agentName: overrides.agentName ?? "Claude Code",
    surfaceId: overrides.surfaceId ?? "surface-1",
    workspaceId: overrides.workspaceId ?? "workspace-1",
    status: overrides.status ?? "idle",
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
    lastStatusChange: overrides.lastStatusChange ?? "2026-01-01T00:00:00.000Z",
  };
}

describe("Agent Registry", () => {
  beforeEach(() => {
    resetRegistry();
  });

  describe("initRegistry", () => {
    it("sets up the API reference and initializes empty state", () => {
      const api = createMockApi();
      initRegistry(api);
      expect(getAgents()).toEqual([]);
    });

    it("clears any pre-existing agent instances on init", () => {
      const api = createMockApi();
      api.state.set("detectedAgents", [makeInstance()]);
      initRegistry(api);
      expect(getAgents()).toEqual([]);
    });
  });

  describe("generateAgentId", () => {
    it("returns a unique string each call", () => {
      const id1 = generateAgentId();
      const id2 = generateAgentId();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^agent-\d+-\d+$/);
      expect(id2).toMatch(/^agent-\d+-\d+$/);
    });
  });

  describe("registerAgent", () => {
    it("adds an instance to state", () => {
      const api = createMockApi();
      initRegistry(api);

      const instance = makeInstance();
      registerAgent(instance);

      const agents = getAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0]).toEqual(instance);
    });

    it("does nothing if registry is not initialized", () => {
      // No initRegistry call
      registerAgent(makeInstance());
      expect(getAgents()).toEqual([]);
    });
  });

  describe("unregisterAgent", () => {
    it("removes an instance by agentId", () => {
      const api = createMockApi();
      initRegistry(api);

      registerAgent(makeInstance({ agentId: "a1" }));
      registerAgent(makeInstance({ agentId: "a2" }));
      expect(getAgents()).toHaveLength(2);

      unregisterAgent("a1");
      const remaining = getAgents();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].agentId).toBe("a2");
    });

    it("is a no-op when agentId does not exist", () => {
      const api = createMockApi();
      initRegistry(api);

      registerAgent(makeInstance({ agentId: "a1" }));
      unregisterAgent("nonexistent");
      expect(getAgents()).toHaveLength(1);
    });

    it("does nothing if registry is not initialized", () => {
      unregisterAgent("a1");
      // Should not throw
      expect(getAgents()).toEqual([]);
    });
  });

  describe("updateAgentStatus", () => {
    it("updates status and lastStatusChange for a given agent", () => {
      const api = createMockApi();
      initRegistry(api);

      registerAgent(
        makeInstance({
          agentId: "a1",
          status: "idle",
          lastStatusChange: "2026-01-01T00:00:00.000Z",
        }),
      );

      updateAgentStatus("a1", "running");

      const agents = getAgents();
      expect(agents[0].status).toBe("running");
      expect(agents[0].lastStatusChange).not.toBe("2026-01-01T00:00:00.000Z");
    });

    it("does not modify other agents", () => {
      const api = createMockApi();
      initRegistry(api);

      registerAgent(makeInstance({ agentId: "a1", status: "idle" }));
      registerAgent(makeInstance({ agentId: "a2", status: "idle" }));

      updateAgentStatus("a1", "running");

      const agents = getAgents();
      expect(agents.find((a) => a.agentId === "a2")!.status).toBe("idle");
    });

    it("is a no-op when agentId does not exist", () => {
      const api = createMockApi();
      initRegistry(api);

      registerAgent(makeInstance({ agentId: "a1", status: "idle" }));
      updateAgentStatus("nonexistent", "running");

      expect(getAgents()[0].status).toBe("idle");
    });
  });

  describe("getAgents", () => {
    it("returns empty array when no instances registered", () => {
      const api = createMockApi();
      initRegistry(api);
      expect(getAgents()).toEqual([]);
    });

    it("returns empty array when registry is not initialized", () => {
      expect(getAgents()).toEqual([]);
    });

    it("returns all registered instances", () => {
      const api = createMockApi();
      initRegistry(api);

      registerAgent(makeInstance({ agentId: "a1" }));
      registerAgent(makeInstance({ agentId: "a2" }));
      registerAgent(makeInstance({ agentId: "a3" }));

      expect(getAgents()).toHaveLength(3);
    });
  });

  describe("multiple register/unregister cycles", () => {
    it("maintains correct state across cycles", () => {
      const api = createMockApi();
      initRegistry(api);

      // Register three
      registerAgent(makeInstance({ agentId: "a1" }));
      registerAgent(makeInstance({ agentId: "a2" }));
      registerAgent(makeInstance({ agentId: "a3" }));
      expect(getAgents()).toHaveLength(3);

      // Remove middle one
      unregisterAgent("a2");
      expect(getAgents()).toHaveLength(2);
      expect(getAgents().map((a) => a.agentId)).toEqual(["a1", "a3"]);

      // Add a new one
      registerAgent(makeInstance({ agentId: "a4" }));
      expect(getAgents()).toHaveLength(3);

      // Remove all
      unregisterAgent("a1");
      unregisterAgent("a3");
      unregisterAgent("a4");
      expect(getAgents()).toEqual([]);

      // Register again after empty
      registerAgent(makeInstance({ agentId: "a5" }));
      expect(getAgents()).toHaveLength(1);
      expect(getAgents()[0].agentId).toBe("a5");
    });
  });
});
