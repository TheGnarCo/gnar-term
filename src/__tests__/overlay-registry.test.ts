/**
 * Tests for overlay-registry — overlay component registration for
 * dialogs, dashboards, and modals rendered above the main UI.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  overlayStore,
  registerOverlay,
  unregisterOverlay,
  unregisterOverlaysBySource,
  resetOverlays,
  type OverlayEntry,
} from "../lib/services/overlay-registry";

function makeOverlay(overrides: Partial<OverlayEntry> = {}): OverlayEntry {
  return {
    id: "test-overlay",
    component: {},
    source: "ext-1",
    ...overrides,
  };
}

describe("overlay-registry", () => {
  beforeEach(() => {
    resetOverlays();
  });

  it("starts empty", () => {
    expect(get(overlayStore)).toEqual([]);
  });

  it("registers an overlay", () => {
    registerOverlay(makeOverlay({ id: "settings" }));
    const items = get(overlayStore);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("settings");
  });

  it("replaces an overlay with the same id", () => {
    const comp1 = { name: "v1" };
    const comp2 = { name: "v2" };
    registerOverlay(makeOverlay({ id: "dup", component: comp1 }));
    registerOverlay(makeOverlay({ id: "dup", component: comp2 }));
    const items = get(overlayStore);
    expect(items).toHaveLength(1);
    expect(items[0].component).toBe(comp2);
  });

  it("unregisters an overlay by id", () => {
    registerOverlay(makeOverlay({ id: "a" }));
    registerOverlay(makeOverlay({ id: "b" }));
    unregisterOverlay("a");
    const items = get(overlayStore);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("b");
  });

  it("unregisters all overlays by source", () => {
    registerOverlay(makeOverlay({ id: "a", source: "ext-1" }));
    registerOverlay(makeOverlay({ id: "b", source: "ext-2" }));
    registerOverlay(makeOverlay({ id: "c", source: "ext-1" }));
    unregisterOverlaysBySource("ext-1");
    const items = get(overlayStore);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("b");
  });

  it("resets to empty", () => {
    registerOverlay(makeOverlay({ id: "a" }));
    resetOverlays();
    expect(get(overlayStore)).toEqual([]);
  });

  it("preserves props", () => {
    registerOverlay(
      makeOverlay({
        id: "dialog",
        props: { title: "Confirm", size: "large" },
      }),
    );
    expect(get(overlayStore)[0].props).toEqual({
      title: "Confirm",
      size: "large",
    });
  });
});
