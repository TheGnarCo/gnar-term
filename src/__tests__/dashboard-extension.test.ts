/**
 * Tests for the dashboard included extension — validates that dashboard
 * registers itself as a surface type and command via the extension API,
 * and that zone state persistence works correctly.
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
  dashboardManifest,
  registerDashboardExtension,
} from "../extensions/dashboard";
import {
  surfaceTypeStore,
  resetSurfaceTypes,
} from "../lib/services/surface-type-registry";
import { commandStore, resetCommands } from "../lib/services/command-registry";
import {
  registerExtension,
  activateExtension,
  resetExtensions,
  createExtensionAPI,
} from "../lib/services/extension-loader";
import {
  registerSidebarTab,
  resetSidebarTabs,
} from "../lib/services/sidebar-tab-registry";
import {
  registerSidebarSection,
  resetSidebarSections,
} from "../lib/services/sidebar-section-registry";

describe("Dashboard included extension", () => {
  beforeEach(async () => {
    await resetExtensions();
    resetSurfaceTypes();
    resetCommands();
    resetSidebarTabs();
    resetSidebarSections();
  });

  // --- Manifest tests ---

  it("manifest has correct id and metadata", () => {
    expect(dashboardManifest.id).toBe("dashboard");
    expect(dashboardManifest.name).toBe("Dashboard");
    expect(dashboardManifest.version).toBe("0.1.0");
    expect(dashboardManifest.included).toBe(true);
  });

  it("manifest declares a surface contribution", () => {
    expect(dashboardManifest.contributes?.surfaces).toEqual([
      { id: "dashboard", label: "Dashboard" },
    ]);
  });

  it("manifest declares a command contribution", () => {
    expect(dashboardManifest.contributes?.commands).toEqual([
      { id: "open-dashboard", title: "Open Dashboard" },
    ]);
  });

  // --- Registration tests ---

  it("registers surface type via API with namespaced id", async () => {
    registerExtension(dashboardManifest, registerDashboardExtension);
    await activateExtension("dashboard");
    const types = get(surfaceTypeStore);
    expect(types).toHaveLength(1);
    expect(types[0].id).toBe("dashboard:dashboard");
    expect(types[0].source).toBe("dashboard");
    expect(types[0].component).toBeTruthy();
  });

  it("registers command via API with namespaced id", async () => {
    registerExtension(dashboardManifest, registerDashboardExtension);
    await activateExtension("dashboard");
    const cmds = get(commandStore);
    const dashCmd = cmds.find((c) => c.id === "dashboard:open-dashboard");
    expect(dashCmd).toBeTruthy();
    expect(dashCmd!.title).toBe("Open Dashboard");
    expect(dashCmd!.source).toBe("dashboard");
  });

  // --- Zone state persistence tests ---

  it("state.set persists zone configuration", () => {
    const { api } = createExtensionAPI(dashboardManifest);
    const zoneConfig = [
      {
        zoneId: "top-left",
        contentType: "tab" as const,
        contentId: "ext:files",
      },
      { zoneId: "top-right", contentType: null, contentId: null },
      {
        zoneId: "bottom-left",
        contentType: "section" as const,
        contentId: "ext:profile",
      },
      { zoneId: "bottom-right", contentType: null, contentId: null },
    ];

    api.state.set("dashboard-test-surface", zoneConfig);
    const retrieved = api.state.get<typeof zoneConfig>(
      "dashboard-test-surface",
    );
    expect(retrieved).toEqual(zoneConfig);
  });

  it("state.get returns undefined for unknown keys", () => {
    const { api } = createExtensionAPI(dashboardManifest);
    expect(api.state.get("dashboard-nonexistent")).toBeUndefined();
  });

  // --- getSidebarTabs / getSidebarSections tests ---

  it("getSidebarTabs returns registered tabs", () => {
    const { api } = createExtensionAPI(dashboardManifest);

    // Register some tabs in the global registry
    const MockComponent = {};
    registerSidebarTab({
      id: "test:files",
      label: "Files",
      component: MockComponent,
      source: "test",
    });
    registerSidebarTab({
      id: "test:search",
      label: "Search",
      component: MockComponent,
      source: "test",
    });

    const tabs = api.getSidebarTabs();
    expect(tabs).toHaveLength(2);
    expect(tabs[0].id).toBe("test:files");
    expect(tabs[0].label).toBe("Files");
    expect(tabs[0].component).toBe(MockComponent);
    expect(tabs[1].id).toBe("test:search");
    expect(tabs[1].label).toBe("Search");
  });

  it("getSidebarSections returns registered sections", () => {
    const { api } = createExtensionAPI(dashboardManifest);

    const MockComponent = {};
    registerSidebarSection({
      id: "test:profile",
      label: "Profile",
      component: MockComponent,
      source: "test",
    });

    const sections = api.getSidebarSections();
    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe("test:profile");
    expect(sections[0].label).toBe("Profile");
    expect(sections[0].component).toBe(MockComponent);
  });

  it("getSidebarTabs returns empty array when no tabs registered", () => {
    const { api } = createExtensionAPI(dashboardManifest);
    expect(api.getSidebarTabs()).toEqual([]);
  });

  it("getSidebarSections returns empty array when no sections registered", () => {
    const { api } = createExtensionAPI(dashboardManifest);
    expect(api.getSidebarSections()).toEqual([]);
  });
});
