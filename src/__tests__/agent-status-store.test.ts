/**
 * Agent Status Store — core store tests
 *
 * Tests the agent status store that maps workspace IDs to the
 * aggregate agent status for rendering dots in WorkspaceItem.
 * Moved from agentic-orchestrator extension tests since this is a core store.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  agentStatusStore,
  setAgentStatus,
  clearAgentStatus,
  resetAgentStatuses,
} from "../lib/stores/agent-status";

describe("Agent Status Store", () => {
  beforeEach(() => {
    resetAgentStatuses();
  });

  it("starts empty", () => {
    expect(get(agentStatusStore)).toEqual({});
  });

  it("sets agent status for a workspace", () => {
    setAgentStatus("ws-1", "running");
    expect(get(agentStatusStore)).toEqual({ "ws-1": "running" });
  });

  it("updates status for existing workspace", () => {
    setAgentStatus("ws-1", "running");
    setAgentStatus("ws-1", "waiting");
    expect(get(agentStatusStore)).toEqual({ "ws-1": "waiting" });
  });

  it("tracks multiple workspaces independently", () => {
    setAgentStatus("ws-1", "running");
    setAgentStatus("ws-2", "waiting");
    expect(get(agentStatusStore)).toEqual({
      "ws-1": "running",
      "ws-2": "waiting",
    });
  });

  it("clears status for a workspace", () => {
    setAgentStatus("ws-1", "running");
    clearAgentStatus("ws-1");
    expect(get(agentStatusStore)).toEqual({});
  });

  it("resets all statuses", () => {
    setAgentStatus("ws-1", "running");
    setAgentStatus("ws-2", "idle");
    resetAgentStatuses();
    expect(get(agentStatusStore)).toEqual({});
  });

  it("handles idle status", () => {
    setAgentStatus("ws-1", "idle");
    expect(get(agentStatusStore)).toEqual({ "ws-1": "idle" });
  });

  it("handles unknown status strings", () => {
    setAgentStatus("ws-1", "custom-status");
    expect(get(agentStatusStore)).toEqual({ "ws-1": "custom-status" });
  });
});
