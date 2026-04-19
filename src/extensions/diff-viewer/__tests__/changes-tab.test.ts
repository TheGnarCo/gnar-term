/**
 * Changes Tab + Auto-Open — Story 3c
 *
 * Tests the Changes sidebar tab manifest in diff-viewer extension
 * and the programmatic tab activation store.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import { diffViewerManifest } from "../index";
import {
  activeSidebarTabStore,
  activateSidebarTab,
  resetSidebarTabs,
} from "../../../lib/services/sidebar-tab-registry";

describe("Changes Tab manifest", () => {
  const tabs = diffViewerManifest.contributes?.secondarySidebarTabs;

  it("declares a changes sidebar tab", () => {
    expect(tabs).toBeDefined();
    const changesTab = tabs!.find((t) => t.id === "changes");
    expect(changesTab).toBeDefined();
    expect(changesTab!.label).toBe("Changes");
  });

  it("subscribes to worktree:merged event", () => {
    const events = diffViewerManifest.contributes?.events;
    expect(events).toContain("extension:worktree:merged");
  });
});

describe("Programmatic tab activation", () => {
  beforeEach(() => {
    resetSidebarTabs();
  });

  it("activeSidebarTabStore starts null", () => {
    expect(get(activeSidebarTabStore)).toBeNull();
  });

  it("activateSidebarTab sets the store value", () => {
    activateSidebarTab("diff-viewer:changes");
    expect(get(activeSidebarTabStore)).toBe("diff-viewer:changes");
  });
});
