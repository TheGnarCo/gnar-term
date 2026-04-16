/**
 * Agents Sidebar Tab — manifest tests
 *
 * Tests that the agentic-orchestrator manifest declares a secondary
 * sidebar tab and that the registration wires it up correctly.
 */
import { describe, it, expect } from "vitest";
import { agenticOrchestratorManifest } from "../index";

describe("Agents Sidebar Tab", () => {
  describe("manifest", () => {
    const tabs = agenticOrchestratorManifest.contributes?.secondarySidebarTabs;

    it("declares a secondary sidebar tab", () => {
      expect(tabs).toBeDefined();
      expect(tabs!.length).toBeGreaterThanOrEqual(1);
    });

    it("declares the agents tab with correct id and label", () => {
      const agentsTab = tabs!.find((t) => t.id === "agents");
      expect(agentsTab).toBeDefined();
      expect(agentsTab!.label).toBe("Agents");
    });

    it("declares a refresh action on the agents tab", () => {
      const agentsTab = tabs!.find((t) => t.id === "agents");
      expect(agentsTab!.actions).toBeDefined();
      const refreshAction = agentsTab!.actions!.find((a) => a.id === "refresh");
      expect(refreshAction).toBeDefined();
      expect(refreshAction!.title).toBe("Refresh");
    });
  });

  describe("events", () => {
    const events = agenticOrchestratorManifest.contributes?.events;

    it("subscribes to agent status events", () => {
      expect(events).toContain("extension:harness:statusChanged");
    });

    it("subscribes to surface lifecycle events", () => {
      expect(events).toContain("surface:created");
      expect(events).toContain("surface:closed");
    });

    it("subscribes to title change events", () => {
      expect(events).toContain("surface:titleChanged");
    });
  });
});
