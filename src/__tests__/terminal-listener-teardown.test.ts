/**
 * Regression test for the terminal-service listener resource leak.
 * Verifies that:
 *   1. teardownListeners() calls the UnlistenFn returned by each listen() call.
 *   2. teardownListeners() can be called safely when no listeners are registered
 *      (e.g. called twice, or before setupListeners).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Track unlisten functions issued by the mock so tests can assert they ran.
const unlistenFns: ReturnType<typeof vi.fn>[] = [];

vi.mock("@tauri-apps/api/event", () => {
  return {
    listen: vi.fn(async (_name: string, _handler: unknown) => {
      const fn = vi.fn();
      unlistenFns.push(fn);
      return fn;
    }),
  };
});
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  Channel: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn().mockResolvedValue(""),
  writeText: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn().mockResolvedValue(true),
  requestPermission: vi.fn().mockResolvedValue("granted"),
  sendNotification: vi.fn(),
}));

import { setupListeners, teardownListeners } from "../lib/terminal-service";

describe("teardownListeners", () => {
  beforeEach(() => {
    unlistenFns.length = 0;
  });

  afterEach(async () => {
    // Drain module-level state between tests
    await teardownListeners();
  });

  it("calls all UnlistenFns returned by listen() when torn down", async () => {
    await setupListeners();

    // Three Tauri listen() calls should have been made
    expect(unlistenFns.length).toBe(3);

    await teardownListeners();

    for (const fn of unlistenFns) {
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });

  it("can be called safely before setupListeners (no throw)", async () => {
    await expect(teardownListeners()).resolves.toBeUndefined();
  });

  it("can be called twice without throwing", async () => {
    await setupListeners();
    await teardownListeners();
    await expect(teardownListeners()).resolves.toBeUndefined();
  });
});
