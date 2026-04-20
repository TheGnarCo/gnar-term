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
  it("manifest subscribes to workspace lifecycle events for claim bookkeeping", () => {
    const events = agenticOrchestratorManifest.contributes?.events;
    // With the Dashboard redesign, the extension owns orchestrator-owned
    // workspaces (Dashboard + spawned worktrees). It claims/unclaims them
    // on create/close so they render nested under the orchestrator row
    // rather than at the root. Detection + status-change handling stays
    // in core (agent-detection-service).
    expect(events).toContain("workspace:created");
    expect(events).toContain("workspace:closed");
    expect(events).not.toContain("extension:harness:statusChanged");
  });
});
