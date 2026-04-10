/**
 * Tests for extension management — install from local path,
 * uninstall, and persistence in config.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

const mockInvoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import {
  installExtensionFromPath,
  uninstallExtension,
  enableExtension,
  disableExtension,
  getInstalledExtensionIds,
  loadExternalExtensions,
} from "../lib/services/extension-management";
import {
  extensionStore,
  resetExtensions,
} from "../lib/services/extension-loader";
import * as config from "../lib/config";

describe("Extension management", () => {
  beforeEach(async () => {
    await resetExtensions();
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
  });

  describe("installExtensionFromPath", () => {
    it("reads manifest from the given path", async () => {
      const manifest = JSON.stringify({
        id: "my-ext",
        name: "My Extension",
        version: "1.0.0",
        entry: "./dist/index.js",
      });
      mockInvoke.mockImplementation((cmd: string, args?: { path?: string }) => {
        if (cmd === "read_file" && args.path.endsWith("extension.json"))
          return Promise.resolve(manifest);
        if (cmd === "get_home") return Promise.resolve("/home/user");
        return Promise.resolve(undefined);
      });

      const result = await installExtensionFromPath("/path/to/my-ext");
      expect(result.success).toBe(true);
      expect(result.extensionId).toBe("my-ext");
    });

    it("returns error for invalid manifest", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "read_file") return Promise.resolve("{}");
        if (cmd === "get_home") return Promise.resolve("/home/user");
        return Promise.resolve(undefined);
      });

      const result = await installExtensionFromPath("/path/to/bad-ext");
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("returns error when manifest file cannot be read", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "read_file")
          return Promise.reject(new Error("File not found"));
        if (cmd === "get_home") return Promise.resolve("/home/user");
        return Promise.resolve(undefined);
      });

      const result = await installExtensionFromPath("/path/to/missing");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to read");
    });

    it("registers the extension in the store after install", async () => {
      const manifest = JSON.stringify({
        id: "installed-ext",
        name: "Installed Extension",
        version: "1.0.0",
        entry: "./dist/index.js",
      });
      mockInvoke.mockImplementation((cmd: string, args?: { path?: string }) => {
        if (cmd === "read_file" && args.path.endsWith("extension.json"))
          return Promise.resolve(manifest);
        if (cmd === "get_home") return Promise.resolve("/home/user");
        return Promise.resolve(undefined);
      });

      await installExtensionFromPath("/path/to/installed-ext");
      const exts = get(extensionStore);
      expect(exts.find((e) => e.manifest.id === "installed-ext")).toBeTruthy();
    });

    it("persists extension source in config via saveConfig", async () => {
      const manifest = JSON.stringify({
        id: "persist-ext",
        name: "Persist Extension",
        version: "1.0.0",
        entry: "./dist/index.js",
      });
      mockInvoke.mockImplementation((cmd: string, args?: { path?: string }) => {
        if (cmd === "read_file" && args.path.endsWith("extension.json"))
          return Promise.resolve(manifest);
        if (cmd === "get_home") return Promise.resolve("/home/user");
        return Promise.resolve(undefined);
      });

      const saveConfigSpy = vi
        .spyOn(config, "saveConfig")
        .mockResolvedValue(undefined);

      await installExtensionFromPath("/path/to/persist-ext");

      expect(saveConfigSpy).toHaveBeenCalledTimes(1);
      const savedExtensions = saveConfigSpy.mock.calls[0][0].extensions;
      expect(savedExtensions["persist-ext"]).toEqual({
        enabled: true,
        source: "local:/path/to/persist-ext",
      });

      saveConfigSpy.mockRestore();
    });
  });

  describe("uninstallExtension", () => {
    it("removes extension from the store and persists removal to config", async () => {
      // First install
      const manifest = JSON.stringify({
        id: "removable-ext",
        name: "Removable",
        version: "1.0.0",
        entry: "./dist/index.js",
      });
      mockInvoke.mockImplementation((cmd: string, args?: { path?: string }) => {
        if (cmd === "read_file" && args.path.endsWith("extension.json"))
          return Promise.resolve(manifest);
        if (cmd === "get_home") return Promise.resolve("/home/user");
        return Promise.resolve(undefined);
      });

      await installExtensionFromPath("/path/to/removable-ext");
      expect(
        get(extensionStore).find((e) => e.manifest.id === "removable-ext"),
      ).toBeTruthy();

      const saveConfigSpy = vi
        .spyOn(config, "saveConfig")
        .mockResolvedValue(undefined);

      await uninstallExtension("removable-ext");
      expect(
        get(extensionStore).find((e) => e.manifest.id === "removable-ext"),
      ).toBeFalsy();

      // Verify config persistence removed the extension
      expect(saveConfigSpy).toHaveBeenCalled();
      const savedExtensions = saveConfigSpy.mock.calls[0][0].extensions;
      expect(savedExtensions["removable-ext"]).toBeUndefined();

      saveConfigSpy.mockRestore();
    });

    it("deletes state files from disk on uninstall", async () => {
      // First install
      const manifest = JSON.stringify({
        id: "stateful-ext",
        name: "Stateful",
        version: "1.0.0",
        entry: "./dist/index.js",
      });
      mockInvoke.mockImplementation((cmd: string, args?: { path?: string }) => {
        if (cmd === "read_file" && args.path.endsWith("extension.json"))
          return Promise.resolve(manifest);
        if (cmd === "get_home") return Promise.resolve("/home/user");
        return Promise.resolve(undefined);
      });

      await installExtensionFromPath("/path/to/stateful-ext");

      vi.spyOn(config, "saveConfig").mockResolvedValue(undefined);
      mockInvoke.mockClear();
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "get_home") return Promise.resolve("/home/user");
        return Promise.resolve(undefined);
      });

      await uninstallExtension("stateful-ext");

      const removeCall = mockInvoke.mock.calls.find(
        (c) => c[0] === "remove_dir",
      );
      expect(removeCall).toBeDefined();
      expect((removeCall![1] as Record<string, unknown>).path).toBe(
        "/home/user/.config/gnar-term/extensions/stateful-ext",
      );
    });
  });

  describe("getInstalledExtensionIds", () => {
    it("returns ids of all loaded extensions", async () => {
      const manifest = JSON.stringify({
        id: "list-ext",
        name: "List Extension",
        version: "1.0.0",
        entry: "./dist/index.js",
      });
      mockInvoke.mockImplementation((cmd: string, args?: { path?: string }) => {
        if (cmd === "read_file" && args.path.endsWith("extension.json"))
          return Promise.resolve(manifest);
        if (cmd === "get_home") return Promise.resolve("/home/user");
        return Promise.resolve(undefined);
      });

      await installExtensionFromPath("/path/to/list-ext");
      const ids = getInstalledExtensionIds();
      expect(ids).toContain("list-ext");
    });
  });

  describe("loadExternalExtensions", () => {
    it("loads and activates extensions from config", async () => {
      const manifest = JSON.stringify({
        id: "auto-load-ext",
        name: "Auto Load Extension",
        version: "1.0.0",
        entry: "./dist/index.js",
      });
      mockInvoke.mockImplementation((cmd: string, args?: { path?: string }) => {
        if (cmd === "read_file" && args?.path?.endsWith("extension.json"))
          return Promise.resolve(manifest);
        if (cmd === "get_home") return Promise.resolve("/home/user");
        return Promise.resolve(undefined);
      });

      vi.spyOn(config, "getConfig").mockReturnValue({
        extensions: {
          "auto-load-ext": {
            enabled: true,
            source: "local:/path/to/auto-load-ext",
          },
        },
      });

      await loadExternalExtensions();
      const exts = get(extensionStore);
      const ext = exts.find((e) => e.manifest.id === "auto-load-ext");
      expect(ext).toBeTruthy();
      expect(ext!.enabled).toBe(true);
    });

    it("skips disabled extensions", async () => {
      vi.spyOn(config, "getConfig").mockReturnValue({
        extensions: {
          "disabled-ext": {
            enabled: false,
            source: "local:/path/to/disabled-ext",
          },
        },
      });

      await loadExternalExtensions();
      const exts = get(extensionStore);
      expect(exts.find((e) => e.manifest.id === "disabled-ext")).toBeFalsy();
    });

    it("skips extensions without a source", async () => {
      vi.spyOn(config, "getConfig").mockReturnValue({
        extensions: {
          "no-source-ext": { enabled: true },
        },
      });

      await loadExternalExtensions();
      const exts = get(extensionStore);
      expect(exts.find((e) => e.manifest.id === "no-source-ext")).toBeFalsy();
    });

    it("continues loading when one extension fails", async () => {
      const goodManifest = JSON.stringify({
        id: "good-ext",
        name: "Good Extension",
        version: "1.0.0",
        entry: "./dist/index.js",
      });
      mockInvoke.mockImplementation((cmd: string, args?: { path?: string }) => {
        if (cmd === "read_file") {
          if (args?.path?.includes("bad-ext"))
            return Promise.reject(new Error("Not found"));
          if (args?.path?.endsWith("extension.json"))
            return Promise.resolve(goodManifest);
        }
        if (cmd === "get_home") return Promise.resolve("/home/user");
        return Promise.resolve(undefined);
      });

      vi.spyOn(config, "getConfig").mockReturnValue({
        extensions: {
          "bad-ext": { enabled: true, source: "local:/path/to/bad-ext" },
          "good-ext": { enabled: true, source: "local:/path/to/good-ext" },
        },
      });

      await loadExternalExtensions();
      const exts = get(extensionStore);
      expect(exts.find((e) => e.manifest.id === "good-ext")).toBeTruthy();
    });
  });

  describe("enableExtension / disableExtension", () => {
    async function installTestExtension(id: string) {
      const manifest = JSON.stringify({
        id,
        name: "Toggle Extension",
        version: "1.0.0",
        entry: "./dist/index.js",
      });
      mockInvoke.mockImplementation((cmd: string, args?: { path?: string }) => {
        if (cmd === "read_file" && args.path.endsWith("extension.json"))
          return Promise.resolve(manifest);
        if (cmd === "get_home") return Promise.resolve("/home/user");
        return Promise.resolve(undefined);
      });
      await installExtensionFromPath(`/path/to/${id}`);
    }

    it("disableExtension deactivates and persists enabled=false", async () => {
      await installTestExtension("toggle-ext");
      const ext = get(extensionStore).find(
        (e) => e.manifest.id === "toggle-ext",
      );
      expect(ext?.enabled).toBe(true);

      const saveConfigSpy = vi
        .spyOn(config, "saveConfig")
        .mockResolvedValue(undefined);
      vi.spyOn(config, "getConfig").mockReturnValue({
        extensions: {
          "toggle-ext": {
            enabled: true,
            source: "local:/path/to/toggle-ext",
          },
        },
      });

      await disableExtension("toggle-ext");

      const after = get(extensionStore).find(
        (e) => e.manifest.id === "toggle-ext",
      );
      expect(after?.enabled).toBe(false);

      expect(saveConfigSpy).toHaveBeenCalledWith({
        extensions: {
          "toggle-ext": {
            enabled: false,
            source: "local:/path/to/toggle-ext",
          },
        },
      });

      saveConfigSpy.mockRestore();
    });

    it("enableExtension activates and persists enabled=true", async () => {
      await installTestExtension("toggle-ext2");

      // Disable first
      vi.spyOn(config, "getConfig").mockReturnValue({
        extensions: {
          "toggle-ext2": {
            enabled: true,
            source: "local:/path/to/toggle-ext2",
          },
        },
      });
      const saveConfigSpy = vi
        .spyOn(config, "saveConfig")
        .mockResolvedValue(undefined);

      await disableExtension("toggle-ext2");
      expect(
        get(extensionStore).find((e) => e.manifest.id === "toggle-ext2")
          ?.enabled,
      ).toBe(false);

      // Re-enable
      vi.spyOn(config, "getConfig").mockReturnValue({
        extensions: {
          "toggle-ext2": {
            enabled: false,
            source: "local:/path/to/toggle-ext2",
          },
        },
      });

      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "get_home") return Promise.resolve("/home/user");
        return Promise.resolve(undefined);
      });

      await enableExtension("toggle-ext2");

      expect(
        get(extensionStore).find((e) => e.manifest.id === "toggle-ext2")
          ?.enabled,
      ).toBe(true);

      const lastSaveCall =
        saveConfigSpy.mock.calls[saveConfigSpy.mock.calls.length - 1];
      expect(lastSaveCall[0].extensions["toggle-ext2"].enabled).toBe(true);

      saveConfigSpy.mockRestore();
    });

    it("disableExtension is a no-op for unknown extension", async () => {
      const saveConfigSpy = vi
        .spyOn(config, "saveConfig")
        .mockResolvedValue(undefined);

      // Should not throw
      await disableExtension("nonexistent");
      expect(saveConfigSpy).not.toHaveBeenCalled();

      saveConfigSpy.mockRestore();
    });
  });
});
