/**
 * Tests for the secondary sidebar tab registry.
 *
 * Extensions register tabs (with components) and actions (with handlers).
 * The registry provides a reactive store for the SecondarySidebar component.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";
import {
  registerSidebarTab,
  unregisterSidebarTabsBySource,
  registerSidebarAction,
  sidebarTabStore,
  sidebarActionStore,
  resetSidebarTabs,
} from "../lib/services/sidebar-tab-registry";

// --- Tab registration ---

describe("sidebarTabStore", () => {
  beforeEach(() => {
    resetSidebarTabs();
  });

  it("starts empty", () => {
    expect(get(sidebarTabStore)).toEqual([]);
  });

  it("registers a tab", () => {
    registerSidebarTab({
      id: "files",
      label: "Files",
      component: "FakeComponent",
      source: "file-browser",
    });

    const tabs = get(sidebarTabStore);
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toEqual({
      id: "files",
      label: "Files",
      component: "FakeComponent",
      source: "file-browser",
    });
  });

  it("registers multiple tabs from different sources", () => {
    registerSidebarTab({
      id: "files",
      label: "Files",
      component: "A",
      source: "ext-a",
    });
    registerSidebarTab({
      id: "chat",
      label: "Chat",
      component: "B",
      source: "ext-b",
    });

    expect(get(sidebarTabStore)).toHaveLength(2);
  });

  it("replaces a tab with the same id", () => {
    registerSidebarTab({
      id: "files",
      label: "Files",
      component: "Old",
      source: "ext-a",
    });
    registerSidebarTab({
      id: "files",
      label: "Files v2",
      component: "New",
      source: "ext-a",
    });

    const tabs = get(sidebarTabStore);
    expect(tabs).toHaveLength(1);
    expect(tabs[0].label).toBe("Files v2");
    expect(tabs[0].component).toBe("New");
  });

  it("unregisters all tabs from a source", () => {
    registerSidebarTab({
      id: "tab1",
      label: "Tab 1",
      component: "A",
      source: "ext-a",
    });
    registerSidebarTab({
      id: "tab2",
      label: "Tab 2",
      component: "B",
      source: "ext-a",
    });
    registerSidebarTab({
      id: "tab3",
      label: "Tab 3",
      component: "C",
      source: "ext-b",
    });

    unregisterSidebarTabsBySource("ext-a");

    const tabs = get(sidebarTabStore);
    expect(tabs).toHaveLength(1);
    expect(tabs[0].id).toBe("tab3");
  });

  it("includes optional icon", () => {
    registerSidebarTab({
      id: "files",
      label: "Files",
      icon: "folder",
      component: "A",
      source: "ext-a",
    });

    expect(get(sidebarTabStore)[0].icon).toBe("folder");
  });
});

// --- Action registration ---

describe("sidebarActionStore", () => {
  beforeEach(() => {
    resetSidebarTabs();
  });

  it("starts empty", () => {
    expect(get(sidebarActionStore)).toEqual([]);
  });

  it("registers an action for a tab", () => {
    const handler = vi.fn();
    registerSidebarAction({
      tabId: "files",
      actionId: "refresh",
      handler,
      source: "ext-a",
    });

    const actions = get(sidebarActionStore);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({
      tabId: "files",
      actionId: "refresh",
      handler,
      source: "ext-a",
    });
  });

  it("unregisterSidebarTabsBySource also removes actions from that source", () => {
    registerSidebarTab({
      id: "files",
      label: "Files",
      component: "A",
      source: "ext-a",
    });
    registerSidebarAction({
      tabId: "files",
      actionId: "refresh",
      handler: vi.fn(),
      source: "ext-a",
    });

    unregisterSidebarTabsBySource("ext-a");

    expect(get(sidebarTabStore)).toHaveLength(0);
    expect(get(sidebarActionStore)).toHaveLength(0);
  });
});
