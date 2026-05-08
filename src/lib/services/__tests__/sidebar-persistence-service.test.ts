/**
 * Unit tests for the sidebar-persistence service.
 *
 * Verifies that:
 *   - `restoreSidebarVisible` applies the persisted boolean to the
 *     `sidebarVisible` store, and is a no-op when the field is absent
 *     (so first-run users keep the default expanded state).
 *   - `persistSidebarVisibleChanges` skips the initial emission (the
 *     just-restored value) but persists subsequent toggles via
 *     `saveState({ sidebarVisible })`.
 *   - `restoreBannerCollapsed` rehydrates `bannerCollapsedState` from
 *     the persisted record and tolerates missing/malformed input.
 *   - `persistBannerCollapsedChanges` skips the initial emission and
 *     serializes subsequent updates back to disk.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

const saveStateMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../../config", async () => {
  const actual =
    await vi.importActual<typeof import("../../config")>("../../config");
  return {
    ...actual,
    saveState: (...args: unknown[]) => saveStateMock(...args),
  };
});

import { sidebarVisible, bannerCollapsedState } from "../../stores/ui";
import {
  restoreSidebarVisible,
  persistSidebarVisibleChanges,
  restoreBannerCollapsed,
  persistBannerCollapsedChanges,
} from "../sidebar-persistence-service";

describe("sidebar-persistence-service", () => {
  beforeEach(() => {
    saveStateMock.mockClear();
    sidebarVisible.set(true);
  });

  describe("restoreSidebarVisible", () => {
    it("applies a persisted true to the store", () => {
      sidebarVisible.set(false);
      restoreSidebarVisible({ sidebarVisible: true });
      expect(get(sidebarVisible)).toBe(true);
    });

    it("applies a persisted false to the store", () => {
      sidebarVisible.set(true);
      restoreSidebarVisible({ sidebarVisible: false });
      expect(get(sidebarVisible)).toBe(false);
    });

    it("is a no-op when sidebarVisible is absent", () => {
      sidebarVisible.set(true);
      restoreSidebarVisible({});
      expect(get(sidebarVisible)).toBe(true);
    });

    it("is a no-op when sidebarVisible is a non-boolean", () => {
      sidebarVisible.set(true);
      // Caller could pass a malformed AppState — guard rejects it.
      restoreSidebarVisible({ sidebarVisible: "yes" } as unknown as Parameters<
        typeof restoreSidebarVisible
      >[0]);
      expect(get(sidebarVisible)).toBe(true);
    });
  });

  describe("persistSidebarVisibleChanges", () => {
    it("skips the first emission (the restored value)", () => {
      sidebarVisible.set(false);
      const unsubscribe = persistSidebarVisibleChanges();
      expect(saveStateMock).not.toHaveBeenCalled();
      unsubscribe();
    });

    it("persists subsequent toggles via saveState", () => {
      sidebarVisible.set(true);
      const unsubscribe = persistSidebarVisibleChanges();

      sidebarVisible.set(false);
      expect(saveStateMock).toHaveBeenCalledTimes(1);
      expect(saveStateMock).toHaveBeenLastCalledWith({ sidebarVisible: false });

      sidebarVisible.set(true);
      expect(saveStateMock).toHaveBeenCalledTimes(2);
      expect(saveStateMock).toHaveBeenLastCalledWith({ sidebarVisible: true });

      unsubscribe();
    });

    it("stops persisting after unsubscribe", () => {
      const unsubscribe = persistSidebarVisibleChanges();
      sidebarVisible.set(false);
      expect(saveStateMock).toHaveBeenCalledTimes(1);

      unsubscribe();

      sidebarVisible.set(true);
      expect(saveStateMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("restoreBannerCollapsed", () => {
    beforeEach(() => bannerCollapsedState.set(new Map()));

    it("rehydrates the store from a persisted record", () => {
      restoreBannerCollapsed({
        bannerCollapsedById: { "ws-1": true, "ws-2": false },
      });
      const map = get(bannerCollapsedState);
      expect(map.get("ws-1")).toBe(true);
      expect(map.get("ws-2")).toBe(false);
      expect(map.size).toBe(2);
    });

    it("is a no-op when bannerCollapsedById is absent", () => {
      bannerCollapsedState.set(new Map([["pre", true]]));
      restoreBannerCollapsed({});
      expect(get(bannerCollapsedState).get("pre")).toBe(true);
    });

    it("ignores non-boolean values inside the record", () => {
      restoreBannerCollapsed({
        bannerCollapsedById: {
          "ws-1": true,
          "ws-2": "yes",
          "ws-3": 1,
        } as unknown as Record<string, boolean>,
      });
      const map = get(bannerCollapsedState);
      expect(map.get("ws-1")).toBe(true);
      expect(map.has("ws-2")).toBe(false);
      expect(map.has("ws-3")).toBe(false);
    });
  });

  describe("persistBannerCollapsedChanges", () => {
    beforeEach(() => bannerCollapsedState.set(new Map()));

    it("skips the first emission (the restored value)", () => {
      bannerCollapsedState.set(new Map([["ws-1", true]]));
      const unsubscribe = persistBannerCollapsedChanges();
      expect(saveStateMock).not.toHaveBeenCalled();
      unsubscribe();
    });

    it("serializes subsequent updates to a record on disk", () => {
      const unsubscribe = persistBannerCollapsedChanges();

      bannerCollapsedState.set(
        new Map([
          ["ws-1", true],
          ["ws-2", false],
        ]),
      );
      expect(saveStateMock).toHaveBeenCalledTimes(1);
      expect(saveStateMock).toHaveBeenLastCalledWith({
        bannerCollapsedById: { "ws-1": true, "ws-2": false },
      });

      bannerCollapsedState.set(new Map([["ws-1", false]]));
      expect(saveStateMock).toHaveBeenCalledTimes(2);
      expect(saveStateMock).toHaveBeenLastCalledWith({
        bannerCollapsedById: { "ws-1": false },
      });

      unsubscribe();
    });

    it("stops persisting after unsubscribe", () => {
      const unsubscribe = persistBannerCollapsedChanges();
      bannerCollapsedState.set(new Map([["ws-1", true]]));
      expect(saveStateMock).toHaveBeenCalledTimes(1);

      unsubscribe();

      bannerCollapsedState.set(new Map([["ws-1", false]]));
      expect(saveStateMock).toHaveBeenCalledTimes(1);
    });
  });
});
