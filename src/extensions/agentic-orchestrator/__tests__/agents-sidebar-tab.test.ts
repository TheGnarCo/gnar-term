/**
 * P11 — global "Agents" secondary sidebar tab.
 *
 * The agentic-orchestrator contributes a tab to the secondary sidebar
 * that mounts AgentList in global-scope mode (no `dashboardId`), giving
 * users a always-on view of every detected agent without needing to
 * open a dashboard markdown file.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import {
  agenticOrchestratorManifest,
  registerAgenticOrchestratorExtension,
} from "..";
import {
  registerExtension,
  activateExtension,
  resetExtensions,
} from "../../../lib/services/extension-loader";
import {
  sidebarTabStore,
  resetSidebarTabs,
} from "../../../lib/services/sidebar-tab-registry";
import { resetAgentDetectionForTests } from "../../../lib/services/agent-detection-service";

const TAB_ID = "agentic-orchestrator:agents";

describe("agentic-orchestrator: global Agents tab (P11)", () => {
  beforeEach(async () => {
    await resetExtensions();
    resetSidebarTabs();
    resetAgentDetectionForTests();
  });

  it("manifest declares the agents tab with id, label, and icon", () => {
    const tabs = agenticOrchestratorManifest.contributes?.secondarySidebarTabs;
    expect(tabs).toEqual([{ id: "agents", label: "Agents", icon: "users" }]);
  });

  it("registers the agents tab against the secondary sidebar tab registry on activation", async () => {
    registerExtension(
      agenticOrchestratorManifest,
      registerAgenticOrchestratorExtension,
    );
    await activateExtension("agentic-orchestrator");

    const tabs = get(sidebarTabStore);
    const agentsTab = tabs.find((t) => t.id === TAB_ID);
    expect(agentsTab).toBeDefined();
    expect(agentsTab!.label).toBe("Agents");
    expect(agentsTab!.source).toBe("agentic-orchestrator");
    // The component must be a real Svelte component (object), not undefined.
    expect(agentsTab!.component).toBeTruthy();
  });

  it("uses AgentList in global-scope mode (no dashboardId prop on the wrapper)", async () => {
    // Source-level assertion: the wrapper component must NOT pass a
    // `dashboardId` to AgentList — that's what gives it the "all agents"
    // semantics. If a future refactor accidentally scopes the tab, this
    // test breaks loudly.
    const fs = await import("fs");
    const src = fs.readFileSync(
      "src/extensions/agentic-orchestrator/components/AgentListSidebarTab.svelte",
      "utf-8",
    );
    expect(src).toMatch(/<AgentList[^>]*\/>/);
    expect(src).not.toMatch(/dashboardId=/);
  });
});
