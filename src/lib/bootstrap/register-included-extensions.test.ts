/**
 * Tests the activation-by-default behavior of registerIncludedExtensions.
 *
 * The bootstrap honors three signals in this order:
 *   1. Explicit `config.extensions[id].enabled` value (true OR false wins).
 *   2. The manifest's `defaultEnabled` flag (used only when no user
 *      preference is recorded).
 *   3. Otherwise the extension stays inactive.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  registerExtensionMock,
  activateExtensionMock,
  reportExtensionErrorMock,
} = vi.hoisted(() => ({
  registerExtensionMock: vi.fn(),
  activateExtensionMock: vi.fn().mockResolvedValue(undefined),
  reportExtensionErrorMock: vi.fn(),
}));

vi.mock("../services/extension-loader", () => ({
  registerExtension: registerExtensionMock,
  activateExtension: activateExtensionMock,
  reportExtensionError: reportExtensionErrorMock,
}));

import { registerIncludedExtensions } from "./register-included-extensions";

describe("registerIncludedExtensions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not auto-activate opt-in extensions when the user has no preference", async () => {
    await registerIncludedExtensions({});
    const ids = activateExtensionMock.mock.calls.map((c) => c[0]);
    // All currently bundled extensions are opt-in (no manifest sets
    // defaultEnabled: true), so a fresh-launch with no user prefs should
    // register everything but activate nothing.
    expect(ids).toEqual([]);
  });

  it("activates an extension when the user explicitly enables it", async () => {
    await registerIncludedExtensions({
      extensions: { "diff-viewer": { enabled: true } },
    });
    expect(activateExtensionMock).toHaveBeenCalledWith("diff-viewer");
  });

  it("respects an explicit user opt-out", async () => {
    await registerIncludedExtensions({
      extensions: { "diff-viewer": { enabled: false } },
    });
    const ids = activateExtensionMock.mock.calls.map((c) => c[0]);
    expect(ids).not.toContain("diff-viewer");
  });

  it("registers every included extension regardless of enabled state", async () => {
    await registerIncludedExtensions({});
    // registerExtension is called for every entry; activation is what's
    // gated on defaultEnabled / user prefs.
    expect(registerExtensionMock).toHaveBeenCalled();
    const registeredIds = registerExtensionMock.mock.calls.map(
      (c) => (c[0] as { id: string }).id,
    );
    expect(registeredIds).toContain("diff-viewer");
    expect(registeredIds).toContain("claude-settings");
    expect(registeredIds).toContain("branched-workspaces");
    expect(registeredIds).toContain("spacebase");
  });
});
