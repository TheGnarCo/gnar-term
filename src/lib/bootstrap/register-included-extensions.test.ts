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
import { agenticManifest } from "../../extensions/agentic";

describe("registerIncludedExtensions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("activates the agentic extension by default when the user has no preference", async () => {
    await registerIncludedExtensions({});
    expect(activateExtensionMock).toHaveBeenCalledWith("agentic");
  });

  it("activates agentic when the user explicitly enables it", async () => {
    await registerIncludedExtensions({
      extensions: { agentic: { enabled: true } },
    });
    expect(activateExtensionMock).toHaveBeenCalledWith("agentic");
  });

  it("respects an explicit user opt-out even when defaultEnabled is true", async () => {
    await registerIncludedExtensions({
      extensions: { agentic: { enabled: false } },
    });
    const ids = activateExtensionMock.mock.calls.map((c) => c[0]);
    expect(ids).not.toContain("agentic");
  });

  it("does not auto-activate extensions whose manifest lacks defaultEnabled", async () => {
    await registerIncludedExtensions({});
    const ids = activateExtensionMock.mock.calls.map((c) => c[0]);
    // diff-viewer and friends are opt-in, so the only auto-activated id
    // should be those with defaultEnabled set on the manifest.
    expect(ids).not.toContain("diff-viewer");
  });

  it("guards against the manifest flag drifting away from `true`", () => {
    // Sanity check — keeps this test honest if someone later flips the
    // manifest. The auto-activation behavior above depends on this.
    expect(agenticManifest.defaultEnabled).toBe(true);
  });
});
