import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI } from "../../api";

import { openPresetLibrary } from "../header/preset-library";

function makeFakeApi(runCommandImpl: (...args: unknown[]) => boolean) {
  const reportError = vi.fn();
  const runCommand = vi.fn().mockImplementation(runCommandImpl);
  const api = { runCommand, reportError } as unknown as ExtensionAPI;
  return { api, runCommand, reportError };
}

describe("openPresetLibrary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls runCommand once with agents tab when it returns true", () => {
    const { api, runCommand, reportError } = makeFakeApi(() => true);
    openPresetLibrary(api);
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand).toHaveBeenCalledWith("core.open-settings", {
      tab: "agents",
    });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("falls back to runCommand without args when first call returns false", () => {
    let callCount = 0;
    const { api, runCommand, reportError } = makeFakeApi(() => {
      callCount++;
      return callCount > 1; // first call false, second true
    });
    openPresetLibrary(api);
    expect(runCommand).toHaveBeenCalledTimes(2);
    expect(runCommand).toHaveBeenNthCalledWith(1, "core.open-settings", {
      tab: "agents",
    });
    expect(runCommand).toHaveBeenNthCalledWith(2, "core.open-settings");
    expect(reportError).not.toHaveBeenCalled();
  });

  it("calls reportError when both runCommand calls return false", () => {
    const { api, runCommand, reportError } = makeFakeApi(() => false);
    openPresetLibrary(api);
    expect(runCommand).toHaveBeenCalledTimes(2);
    expect(reportError).toHaveBeenCalledWith(
      expect.stringContaining("open-settings"),
    );
  });
});
