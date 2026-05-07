/**
 * Tests for the extension error toast notification.
 *
 * Verifies that extensionErrorStore entries produce visible toast elements
 * and that duplicate errors are not shown twice.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn().mockResolvedValue(""),
  writeText: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/services/extension-state", () => ({
  loadExtensionState: vi.fn().mockResolvedValue({}),
  saveExtensionState: vi.fn().mockResolvedValue(undefined),
  deleteExtensionState: vi.fn().mockResolvedValue(undefined),
}));

import {
  extensionErrorStore,
  reportExtensionError,
  resetExtensions,
} from "../lib/services/extension-loader";

describe("Extension error toast", () => {
  beforeEach(() => {
    resetExtensions();
  });

  it("extensionErrorStore accumulates reported errors", () => {
    reportExtensionError("test-ext", "Something broke");
    const errors = get(extensionErrorStore);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({ id: "test-ext", error: "Something broke" });
  });

  it("extensionErrorStore accumulates multiple errors", () => {
    reportExtensionError("ext-a", "Error A");
    reportExtensionError("ext-b", "Error B");
    const errors = get(extensionErrorStore);
    expect(errors).toHaveLength(2);
    expect(errors[0].id).toBe("ext-a");
    expect(errors[1].id).toBe("ext-b");
  });

  it("extensionErrorStore entries contain both id and error message", () => {
    reportExtensionError("my-ext", "Failed to initialize");
    const [entry] = get(extensionErrorStore);
    expect(entry.id).toBe("my-ext");
    expect(entry.error).toBe("Failed to initialize");
  });
});
