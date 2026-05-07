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

import { sidebarVisible } from "../../stores/ui";
import {
  restoreSidebarVisible,
  persistSidebarVisibleChanges,
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
});
