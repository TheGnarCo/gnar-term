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
  it("manifest subscribes to harness status events for badge updates", () => {
    const events = agenticOrchestratorManifest.contributes?.events;
    expect(events).toContain("extension:harness:statusChanged");
  });
});
