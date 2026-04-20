/**
 * Sidebar Tab Badges — Story 1d
 *
 * Tests the badge store for secondary sidebar tabs and the
 * agentic-orchestrator's auto-badge behavior on "waiting" status.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  sidebarTabBadgeStore,
  setSidebarTabBadge,
  clearSidebarTabBadge,
  resetSidebarTabBadges,
} from "../lib/services/sidebar-tab-registry";
import { agenticOrchestratorManifest } from "../extensions/agentic-orchestrator/index";

describe("Sidebar Tab Badges", () => {
  beforeEach(() => {
    resetSidebarTabBadges();
  });

  it("starts with empty badge map", () => {
    expect(get(sidebarTabBadgeStore)).toEqual({});
  });

  it("sets a badge on a tab", () => {
    setSidebarTabBadge("agents", true);
    expect(get(sidebarTabBadgeStore)).toEqual({ agents: true });
  });

  it("clears a badge on a tab", () => {
    setSidebarTabBadge("agents", true);
    clearSidebarTabBadge("agents");
    expect(get(sidebarTabBadgeStore)).toEqual({});
  });

  it("supports multiple tab badges simultaneously", () => {
    setSidebarTabBadge("agents", true);
    setSidebarTabBadge("changes", true);
    expect(get(sidebarTabBadgeStore)).toEqual({
      agents: true,
      changes: true,
    });
  });
});

describe("Agentic Orchestrator badge integration", () => {
  it("manifest subscribes to workspace:activated (dashboard preview re-spawn)", () => {
    const events = agenticOrchestratorManifest.contributes?.events;
    // Detection + status-change handling moved to core (agent-detection-service).
    // The extension no longer needs to subscribe to agent:statusChanged — it
    // only listens for workspace:activated to re-spawn closed dashboard previews.
    expect(events).toContain("workspace:activated");
    expect(events).not.toContain("extension:harness:statusChanged");
  });
});
