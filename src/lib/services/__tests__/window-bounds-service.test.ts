/**
 * Unit tests for the window-bounds persistence service.
 *
 * Verifies that:
 *   - restoreWindowBounds applies the persisted size + position to the live
 *     window when bounds are present, and is a no-op when bounds are absent
 *     or partial fields are missing.
 *   - saveWindowBounds reads the live size + position and forwards them to
 *     `saveState({ windowBounds: ... })`.
 *
 * Both helpers must swallow errors from the Tauri window API so a flaky
 * platform call cannot strand startup or block quit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";

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

import {
  restoreWindowBounds,
  saveWindowBounds,
  type WindowBoundsApi,
} from "../window-bounds-service";

function makeWindow(overrides: Partial<WindowBoundsApi> = {}): {
  api: WindowBoundsApi;
  setSize: ReturnType<typeof vi.fn>;
  setPosition: ReturnType<typeof vi.fn>;
  outerSize: ReturnType<typeof vi.fn>;
  outerPosition: ReturnType<typeof vi.fn>;
} {
  const setSize = vi.fn().mockResolvedValue(undefined);
  const setPosition = vi.fn().mockResolvedValue(undefined);
  const outerSize = vi.fn().mockResolvedValue({ width: 1440, height: 900 });
  const outerPosition = vi.fn().mockResolvedValue({ x: 120, y: 80 });
  const api: WindowBoundsApi = {
    setSize,
    setPosition,
    outerSize,
    outerPosition,
    ...overrides,
  };
  return { api, setSize, setPosition, outerSize, outerPosition };
}

describe("window-bounds-service", () => {
  beforeEach(() => {
    saveStateMock.mockClear();
  });

  describe("restoreWindowBounds", () => {
    it("applies size and position from a fully-populated bounds record", async () => {
      const { api, setSize, setPosition } = makeWindow();
      await restoreWindowBounds(
        { x: 100, y: 50, width: 1280, height: 720 },
        api,
      );
      expect(setSize).toHaveBeenCalledTimes(1);
      const sizeArg = setSize.mock.calls[0]![0] as PhysicalSize;
      expect(sizeArg).toBeInstanceOf(PhysicalSize);
      expect(sizeArg.width).toBe(1280);
      expect(sizeArg.height).toBe(720);

      expect(setPosition).toHaveBeenCalledTimes(1);
      const posArg = setPosition.mock.calls[0]![0] as PhysicalPosition;
      expect(posArg).toBeInstanceOf(PhysicalPosition);
      expect(posArg.x).toBe(100);
      expect(posArg.y).toBe(50);
    });

    it("is a no-op when bounds is undefined", async () => {
      const { api, setSize, setPosition } = makeWindow();
      await restoreWindowBounds(undefined, api);
      expect(setSize).not.toHaveBeenCalled();
      expect(setPosition).not.toHaveBeenCalled();
    });

    it("applies size only when position fields are missing", async () => {
      const { api, setSize, setPosition } = makeWindow();
      await restoreWindowBounds({ width: 1280, height: 720 }, api);
      expect(setSize).toHaveBeenCalledTimes(1);
      expect(setPosition).not.toHaveBeenCalled();
    });

    it("applies position only when size fields are missing", async () => {
      const { api, setSize, setPosition } = makeWindow();
      await restoreWindowBounds({ x: 100, y: 50 }, api);
      expect(setSize).not.toHaveBeenCalled();
      expect(setPosition).toHaveBeenCalledTimes(1);
    });

    it("swallows errors from the window API", async () => {
      const setSize = vi.fn().mockRejectedValue(new Error("boom"));
      const { api } = makeWindow({ setSize });
      await expect(
        restoreWindowBounds({ x: 0, y: 0, width: 800, height: 600 }, api),
      ).resolves.toBeUndefined();
    });
  });

  describe("saveWindowBounds", () => {
    it("reads outer size + position and forwards them to saveState", async () => {
      const { api } = makeWindow();
      await saveWindowBounds(api);
      expect(saveStateMock).toHaveBeenCalledTimes(1);
      expect(saveStateMock).toHaveBeenCalledWith({
        windowBounds: { x: 120, y: 80, width: 1440, height: 900 },
      });
    });

    it("swallows errors from outerSize", async () => {
      const outerSize = vi.fn().mockRejectedValue(new Error("size failed"));
      const { api } = makeWindow({ outerSize });
      await expect(saveWindowBounds(api)).resolves.toBeUndefined();
      expect(saveStateMock).not.toHaveBeenCalled();
    });

    it("swallows errors from outerPosition", async () => {
      const outerPosition = vi.fn().mockRejectedValue(new Error("pos failed"));
      const { api } = makeWindow({ outerPosition });
      await expect(saveWindowBounds(api)).resolves.toBeUndefined();
      expect(saveStateMock).not.toHaveBeenCalled();
    });
  });
});
