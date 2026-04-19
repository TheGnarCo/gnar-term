/**
 * Tests for the dashboard tab registry and dashboard state store.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  dashboardTabStore,
  registerDashboardTab,
  unregisterDashboardTabsBySource,
  resetDashboardTabs,
} from "../lib/services/dashboard-tab-registry";

describe("Dashboard Tab Registry", () => {
  beforeEach(() => {
    resetDashboardTabs();
  });

  it("starts empty", () => {
    expect(get(dashboardTabStore)).toHaveLength(0);
  });

  it("registers a dashboard tab", () => {
    registerDashboardTab({
      id: "ext:worktrees",
      label: "Worktrees",
      component: {} as unknown,
      source: "worktree-workspaces",
    });

    const tabs = get(dashboardTabStore);
    expect(tabs).toHaveLength(1);
    expect(tabs[0].id).toBe("ext:worktrees");
    expect(tabs[0].label).toBe("Worktrees");
    expect(tabs[0].source).toBe("worktree-workspaces");
  });

  it("unregisters tabs by source", () => {
    registerDashboardTab({
      id: "ext:tab1",
      label: "Tab 1",
      component: {},
      source: "ext-a",
    });
    registerDashboardTab({
      id: "ext:tab2",
      label: "Tab 2",
      component: {},
      source: "ext-b",
    });
    registerDashboardTab({
      id: "ext:tab3",
      label: "Tab 3",
      component: {},
      source: "ext-a",
    });

    expect(get(dashboardTabStore)).toHaveLength(3);

    unregisterDashboardTabsBySource("ext-a");
    const remaining = get(dashboardTabStore);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe("ext:tab2");
  });

  it("reset clears all tabs", () => {
    registerDashboardTab({
      id: "ext:tab1",
      label: "Tab 1",
      component: {},
      source: "ext-a",
    });
    expect(get(dashboardTabStore)).toHaveLength(1);

    resetDashboardTabs();
    expect(get(dashboardTabStore)).toHaveLength(0);
  });
});
