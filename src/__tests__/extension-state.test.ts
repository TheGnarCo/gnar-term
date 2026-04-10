/**
 * Tests for extension state persistence.
 *
 * Tests the state service that bridges the in-memory extension state
 * with disk persistence via Tauri invoke.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  loadExtensionState,
  saveExtensionState,
  deleteExtensionState,
  getExtensionStatePath,
} from "../lib/services/extension-state";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

const mockInvoke = vi.mocked(invoke);

describe("extension-state", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  describe("getExtensionStatePath", () => {
    it("returns the correct path for an extension id", async () => {
      mockInvoke.mockResolvedValueOnce("/home/user"); // get_home
      const path = await getExtensionStatePath("my-ext");
      expect(path).toBe(
        "/home/user/.config/gnar-term/extensions/my-ext/state.json",
      );
    });
  });

  describe("loadExtensionState", () => {
    it("reads and parses state from disk", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_home") return "/home/user";
        if (cmd === "read_file")
          return JSON.stringify({ count: 42, name: "test" });
        return undefined;
      });

      const state = await loadExtensionState("my-ext");
      expect(state).toEqual({ count: 42, name: "test" });
    });

    it("returns empty object when file does not exist", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_home") return "/home/user";
        if (cmd === "read_file") throw new Error("file not found");
        return undefined;
      });

      const state = await loadExtensionState("my-ext");
      expect(state).toEqual({});
    });

    it("returns empty object on invalid JSON", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_home") return "/home/user";
        if (cmd === "read_file") return "not valid json{{{";
        return undefined;
      });

      const state = await loadExtensionState("my-ext");
      expect(state).toEqual({});
    });
  });

  describe("saveExtensionState", () => {
    it("writes state to disk as JSON", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_home") return "/home/user";
        return undefined;
      });

      await saveExtensionState("my-ext", { count: 42 });

      // Should have called ensure_dir and write_file
      const ensureCall = mockInvoke.mock.calls.find(
        (c) => c[0] === "ensure_dir",
      );
      const writeCall = mockInvoke.mock.calls.find(
        (c) => c[0] === "write_file",
      );

      expect(ensureCall).toBeDefined();
      expect((ensureCall![1] as Record<string, unknown>).path).toBe(
        "/home/user/.config/gnar-term/extensions/my-ext",
      );

      expect(writeCall).toBeDefined();
      expect((writeCall![1] as Record<string, unknown>).path).toBe(
        "/home/user/.config/gnar-term/extensions/my-ext/state.json",
      );
      expect(
        JSON.parse((writeCall![1] as Record<string, unknown>).content),
      ).toEqual({ count: 42 });
    });

    it("does not throw on write failure", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_home") return "/home/user";
        if (cmd === "write_file") throw new Error("disk full");
        return undefined;
      });

      // Should not throw
      await expect(
        saveExtensionState("my-ext", { data: "test" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("deleteExtensionState", () => {
    it("calls remove_dir with the correct path", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_home") return "/home/user";
        return undefined;
      });

      await deleteExtensionState("my-ext");

      const removeCall = mockInvoke.mock.calls.find(
        (c) => c[0] === "remove_dir",
      );
      expect(removeCall).toBeDefined();
      expect((removeCall![1] as Record<string, unknown>).path).toBe(
        "/home/user/.config/gnar-term/extensions/my-ext",
      );
    });

    it("does not throw on removal failure", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_home") return "/home/user";
        if (cmd === "remove_dir") throw new Error("permission denied");
        return undefined;
      });

      await expect(deleteExtensionState("my-ext")).resolves.toBeUndefined();
    });
  });
});
