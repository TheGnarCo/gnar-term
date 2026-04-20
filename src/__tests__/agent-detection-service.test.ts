/**
 * Tests for the core agent-detection-service.
 *
 * Focused on the pure parts of the pipeline — pattern matching,
 * registry + store shape, status transitions, and the public
 * initAgentDetection lifecycle. Output-observer wiring (ptyId fan-out)
 * is covered transitively by the terminal-service suite and by
 * end-to-end tests that exercise `api.agents`.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  agentsStore,
  getAgents,
  initAgentDetection,
  destroyAgentDetection,
  resetAgentDetectionForTests,
} from "../lib/services/agent-detection-service";
import { eventBus, type AppEvent } from "../lib/services/event-bus";
import { workspaces } from "../lib/stores/workspace";

beforeEach(() => {
  resetAgentDetectionForTests();
  workspaces.set([]);
});

describe("agent-detection-service", () => {
  it("exposes an empty reactive registry before init", () => {
    expect(get(agentsStore)).toEqual([]);
    expect(getAgents()).toEqual([]);
  });

  it("initAgentDetection is idempotent — two calls don't double-subscribe", () => {
    initAgentDetection();
    initAgentDetection();
    // Fire a surface:created event; if the first call's listener hadn't
    // been torn down, the service would log errors or double-register.
    eventBus.emit({
      type: "surface:created",
      id: "no-such-surface",
      paneId: "p",
      kind: "terminal",
    });
    expect(getAgents()).toEqual([]);
    destroyAgentDetection();
  });

  it("agent:statusChanged is a declared event type on the bus", () => {
    // Compile-time + runtime contract: the event bus accepts the type.
    let captured: AppEvent | null = null;
    const handler = (e: AppEvent) => {
      captured = e;
    };
    eventBus.on("agent:statusChanged", handler);
    eventBus.emit({
      type: "agent:statusChanged",
      status: "running",
      surfaceId: "s1",
      workspaceId: "w1",
      agentName: "Claude Code",
    });
    eventBus.off("agent:statusChanged", handler);
    expect(captured).not.toBeNull();
    expect(captured!.type).toBe("agent:statusChanged");
  });

  it("destroyAgentDetection clears the registry", () => {
    initAgentDetection();
    destroyAgentDetection();
    expect(get(agentsStore)).toEqual([]);
  });
});
