/**
 * Tests for the gh-availability helper — verifies the probe caches the
 * first result and that `invalidate` forces a re-probe.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import {
  isGhAvailable,
  invalidateGhAvailability,
} from "../lib/services/gh-availability";

describe("gh-availability", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invalidateGhAvailability();
  });

  it("returns true when gh_available resolves true", async () => {
    invokeMock.mockResolvedValueOnce(true);
    await expect(isGhAvailable()).resolves.toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("gh_available");
  });

  it("returns false when gh_available resolves false", async () => {
    invokeMock.mockResolvedValueOnce(false);
    await expect(isGhAvailable()).resolves.toBe(false);
  });

  it("returns false when gh_available rejects (probe itself failed)", async () => {
    invokeMock.mockRejectedValueOnce(new Error("command not allowed"));
    await expect(isGhAvailable()).resolves.toBe(false);
  });

  it("caches the first result — subsequent calls do not re-invoke", async () => {
    invokeMock.mockResolvedValueOnce(true);
    await isGhAvailable();
    await isGhAvailable();
    await isGhAvailable();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("re-probes after invalidate", async () => {
    invokeMock.mockResolvedValueOnce(true);
    await isGhAvailable();
    invalidateGhAvailability();
    invokeMock.mockResolvedValueOnce(false);
    await expect(isGhAvailable()).resolves.toBe(false);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});
