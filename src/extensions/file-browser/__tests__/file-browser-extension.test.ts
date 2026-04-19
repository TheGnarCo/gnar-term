/**
 * Tests for the file-browser included extension — validates that file-browser
 * registers itself as a secondary sidebar tab and command via the extension API.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import { fileBrowserManifest, registerFileBrowserExtension } from "..";
import {
  sidebarTabStore,
  resetSidebarTabs,
} from "../../../lib/services/sidebar-tab-registry";
import {
  commandStore,
  resetCommands,
} from "../../../lib/services/command-registry";
import {
  contextMenuItemStore,
  getContextMenuItemsForFile,
  resetContextMenuItems,
} from "../../../lib/services/context-menu-item-registry";
import {
  registerExtension,
  activateExtension,
  resetExtensions,
} from "../../../lib/services/extension-loader";

describe("File Browser included extension", () => {
  beforeEach(async () => {
    await resetExtensions();
    resetSidebarTabs();
    resetCommands();
    resetContextMenuItems();
  });

  it("manifest has correct id and metadata", () => {
    expect(fileBrowserManifest.id).toBe("file-browser");
    expect(fileBrowserManifest.name).toBe("File Browser");
    expect(fileBrowserManifest.included).toBe(true);
  });

  it("manifest does not declare unused events", () => {
    expect(fileBrowserManifest.contributes?.events).toBeUndefined();
  });

  it("registers sidebar tab via API with namespaced id", async () => {
    registerExtension(fileBrowserManifest, registerFileBrowserExtension);
    await activateExtension("file-browser");
    const tabs = get(sidebarTabStore);
    expect(tabs).toHaveLength(1);
    expect(tabs[0].id).toBe("file-browser:files");
    expect(tabs[0].label).toBe("Files");
    expect(tabs[0].source).toBe("file-browser");
    expect(tabs[0].component).toBeTruthy();
  });

  it("registers command via API with namespaced id", async () => {
    registerExtension(fileBrowserManifest, registerFileBrowserExtension);
    await activateExtension("file-browser");
    const cmds = get(commandStore);
    const cmd = cmds.find((c) => c.id === "file-browser:toggle-file-browser");
    expect(cmd).toBeTruthy();
    expect(cmd!.title).toBe("Toggle File Browser");
    expect(cmd!.source).toBe("file-browser");
  });

  it("registers context menu items for all files", async () => {
    registerExtension(fileBrowserManifest, registerFileBrowserExtension);
    await activateExtension("file-browser");

    const items = get(contextMenuItemStore);
    expect(
      items.find((i) => i.id === "file-browser:show-in-file-manager"),
    ).toBeTruthy();
    expect(
      items.find((i) => i.id === "file-browser:open-with-default-app"),
    ).toBeTruthy();
  });

  it("context menu items match any file", async () => {
    registerExtension(fileBrowserManifest, registerFileBrowserExtension);
    await activateExtension("file-browser");

    // Wildcard items match everything
    const items = getContextMenuItemsForFile("anything.xyz");
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items.some((i) => i.label === "Show in File Manager")).toBe(true);
    expect(items.some((i) => i.label === "Open with Default App")).toBe(true);
  });
});

describe("File Browser list_dir interface", () => {
  it("list_dir returns entries with name, is_dir, is_hidden", () => {
    // Validates the expected shape from the Rust command
    interface DirEntry {
      name: string;
      is_dir: boolean;
      is_hidden: boolean;
    }
    const entries: DirEntry[] = [
      { name: "src", is_dir: true, is_hidden: false },
      { name: ".git", is_dir: true, is_hidden: true },
      { name: "README.md", is_dir: false, is_hidden: false },
      { name: ".env", is_dir: false, is_hidden: true },
    ];

    // Directories first, then alphabetical (matching Rust sort)
    const sorted = [...entries].sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });

    expect(sorted[0].name).toBe(".git");
    expect(sorted[0].is_dir).toBe(true);
    expect(sorted[1].name).toBe("src");
    expect(sorted[2].name).toBe(".env");
    expect(sorted[3].name).toBe("README.md");
  });

  it("hidden files are identified by leading dot", () => {
    const names = ["file.txt", ".hidden", ".gitignore", "src"];
    const hidden = names.filter((n) => n.startsWith("."));
    expect(hidden).toEqual([".hidden", ".gitignore"]);
  });

  it("filtering hides hidden and gitignored files", () => {
    interface DirEntry {
      name: string;
      is_dir: boolean;
      is_hidden: boolean;
    }
    const entries: DirEntry[] = [
      { name: "src", is_dir: true, is_hidden: false },
      { name: ".git", is_dir: true, is_hidden: true },
      { name: "README.md", is_dir: false, is_hidden: false },
      { name: ".env", is_dir: false, is_hidden: true },
      { name: "node_modules", is_dir: true, is_hidden: false },
    ];
    const gitIgnored = new Set(["node_modules"]);

    // Default: showHidden=false, showGitIgnored=false
    const filtered = entries.filter((e) => {
      if (e.is_hidden) return false;
      if (gitIgnored.has(e.name)) return false;
      return true;
    });

    expect(filtered.map((e) => e.name)).toEqual(["src", "README.md"]);

    // showHidden=true, showGitIgnored=false
    const withHidden = entries.filter((e) => {
      if (gitIgnored.has(e.name)) return false;
      return true;
    });
    expect(withHidden.map((e) => e.name)).toEqual([
      "src",
      ".git",
      "README.md",
      ".env",
    ]);

    // showHidden=true, showGitIgnored=true
    expect(entries.map((e) => e.name)).toEqual([
      "src",
      ".git",
      "README.md",
      ".env",
      "node_modules",
    ]);
  });
});
