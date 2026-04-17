/**
 * Tests for the extension context menu item registry.
 *
 * Extensions register context menu items with file-type matchers.
 * The registry resolves which items apply to a given file context.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import { get } from "svelte/store";
import {
  registerContextMenuItem,
  unregisterContextMenuItemsBySource,
  getContextMenuItemsForFile,
  getContextMenuItemsForDir,
  contextMenuItemStore,
  resetContextMenuItems,
  validateWhenPattern,
  getRegisteredFileExtensions,
} from "../lib/services/context-menu-item-registry";

describe("context-menu-item-registry", () => {
  beforeEach(() => {
    resetContextMenuItems();
  });

  it("registers a context menu item", () => {
    registerContextMenuItem({
      id: "ext:preview",
      label: "Open as Preview",
      when: "*.md",
      handler: () => {},
      source: "preview",
    });
    expect(get(contextMenuItemStore)).toHaveLength(1);
  });

  it("matches items by single extension", () => {
    registerContextMenuItem({
      id: "ext:preview-md",
      label: "Preview",
      when: "*.md",
      handler: () => {},
      source: "preview",
    });
    registerContextMenuItem({
      id: "ext:preview-json",
      label: "Preview",
      when: "*.json",
      handler: () => {},
      source: "preview",
    });

    const mdItems = getContextMenuItemsForFile("/path/to/readme.md");
    expect(mdItems).toHaveLength(1);
    expect(mdItems[0].id).toBe("ext:preview-md");

    const jsonItems = getContextMenuItemsForFile("/path/to/data.json");
    expect(jsonItems).toHaveLength(1);
    expect(jsonItems[0].id).toBe("ext:preview-json");
  });

  it("matches items with brace expansion (*.{png,jpg,gif})", () => {
    registerContextMenuItem({
      id: "ext:preview-img",
      label: "Preview Image",
      when: "*.{png,jpg,gif}",
      handler: () => {},
      source: "preview",
    });

    expect(getContextMenuItemsForFile("photo.png")).toHaveLength(1);
    expect(getContextMenuItemsForFile("photo.jpg")).toHaveLength(1);
    expect(getContextMenuItemsForFile("photo.gif")).toHaveLength(1);
    expect(getContextMenuItemsForFile("photo.bmp")).toHaveLength(0);
  });

  it("matches wildcard (*) for all files", () => {
    registerContextMenuItem({
      id: "ext:open-default",
      label: "Open with Default App",
      when: "*",
      handler: () => {},
      source: "file-browser",
    });

    expect(getContextMenuItemsForFile("anything.txt")).toHaveLength(1);
    expect(getContextMenuItemsForFile("no-extension")).toHaveLength(1);
  });

  it("returns items from multiple extensions", () => {
    registerContextMenuItem({
      id: "preview:open",
      label: "Open as Preview",
      when: "*.md",
      handler: () => {},
      source: "preview",
    });
    registerContextMenuItem({
      id: "file-browser:show",
      label: "Show in File Manager",
      when: "*",
      handler: () => {},
      source: "file-browser",
    });

    const items = getContextMenuItemsForFile("readme.md");
    expect(items).toHaveLength(2);
  });

  it("unregisters by source", () => {
    registerContextMenuItem({
      id: "preview:open",
      label: "Open as Preview",
      when: "*.md",
      handler: () => {},
      source: "preview",
    });
    registerContextMenuItem({
      id: "file-browser:show",
      label: "Show in File Manager",
      when: "*",
      handler: () => {},
      source: "file-browser",
    });

    unregisterContextMenuItemsBySource("preview");
    expect(get(contextMenuItemStore)).toHaveLength(1);
    expect(get(contextMenuItemStore)[0].source).toBe("file-browser");
  });

  it("is case-insensitive for file extension matching", () => {
    registerContextMenuItem({
      id: "ext:img",
      label: "Preview",
      when: "*.PNG",
      handler: () => {},
      source: "preview",
    });

    expect(getContextMenuItemsForFile("photo.png")).toHaveLength(1);
    expect(getContextMenuItemsForFile("photo.PNG")).toHaveLength(1);
  });

  it("directory items only match via getContextMenuItemsForDir", () => {
    registerContextMenuItem({
      id: "ext:open-ws",
      label: "Open as Workspace",
      when: "directory",
      handler: () => {},
      source: "file-browser",
    });
    registerContextMenuItem({
      id: "ext:edit",
      label: "Edit",
      when: "*",
      handler: () => {},
      source: "file-browser",
    });

    // File queries should NOT include directory items
    const fileItems = getContextMenuItemsForFile("/path/to/src");
    expect(fileItems).toHaveLength(1);
    expect(fileItems[0].id).toBe("ext:edit");

    // Dir queries should only include directory items
    const dirItems = getContextMenuItemsForDir("/path/to/src");
    expect(dirItems).toHaveLength(1);
    expect(dirItems[0].id).toBe("ext:open-ws");
  });

  describe("getRegisteredFileExtensions", () => {
    it("returns empty array when no items are registered", () => {
      resetContextMenuItems();
      expect(getRegisteredFileExtensions()).toEqual([]);
    });

    it("extracts extensions from *.ext patterns", () => {
      resetContextMenuItems();
      registerContextMenuItem({
        id: "a",
        source: "ext-a",
        label: "A",
        when: "*.md",
        handler: () => {},
      });
      expect(getRegisteredFileExtensions()).toEqual(["md"]);
    });

    it("extracts extensions from brace patterns", () => {
      resetContextMenuItems();
      registerContextMenuItem({
        id: "b",
        source: "ext-b",
        label: "B",
        when: "*.{png,jpg,gif}",
        handler: () => {},
      });
      expect(getRegisteredFileExtensions().sort()).toEqual([
        "gif",
        "jpg",
        "png",
      ]);
    });

    it("merges and dedupes extensions across multiple items", () => {
      resetContextMenuItems();
      registerContextMenuItem({
        id: "c1",
        source: "ext-c",
        label: "C1",
        when: "*.md",
        handler: () => {},
      });
      registerContextMenuItem({
        id: "c2",
        source: "ext-c",
        label: "C2",
        when: "*.{md,json}",
        handler: () => {},
      });
      expect(getRegisteredFileExtensions().sort()).toEqual(["json", "md"]);
    });

    it("ignores '*' and 'directory' patterns", () => {
      resetContextMenuItems();
      registerContextMenuItem({
        id: "d1",
        source: "ext-d",
        label: "D1",
        when: "*",
        handler: () => {},
      });
      registerContextMenuItem({
        id: "d2",
        source: "ext-d",
        label: "D2",
        when: "directory",
        handler: () => {},
      });
      registerContextMenuItem({
        id: "d3",
        source: "ext-d",
        label: "D3",
        when: "*.toml",
        handler: () => {},
      });
      expect(getRegisteredFileExtensions()).toEqual(["toml"]);
    });

    it("lowercases extensions", () => {
      resetContextMenuItems();
      registerContextMenuItem({
        id: "e",
        source: "ext-e",
        label: "E",
        when: "*.PDF",
        handler: () => {},
      });
      expect(getRegisteredFileExtensions()).toEqual(["pdf"]);
    });
  });
});

describe("validateWhenPattern", () => {
  it("accepts the documented shapes", () => {
    expect(validateWhenPattern("*")).toBeNull();
    expect(validateWhenPattern("directory")).toBeNull();
    expect(validateWhenPattern("*.md")).toBeNull();
    expect(validateWhenPattern("*.{md,json,png}")).toBeNull();
  });

  it("rejects empty extension lists", () => {
    expect(validateWhenPattern("*.{}")).not.toBeNull();
    expect(validateWhenPattern("*.{md,}")).not.toBeNull();
    expect(validateWhenPattern("*.{,md}")).not.toBeNull();
  });

  it("rejects unsupported shapes", () => {
    expect(validateWhenPattern("**")).not.toBeNull();
    expect(validateWhenPattern("foo.md")).not.toBeNull();
    expect(validateWhenPattern("*.md ")).not.toBeNull();
    expect(validateWhenPattern("")).not.toBeNull();
  });
});

describe("terminal-service <-> context-menu integration", () => {
  it("terminal-service imports getRegisteredFileExtensions from the registry, not from preview", async () => {
    // Note: jsdom's URL resolves relative URLs against the document base
    // (http://localhost:3000/), not against a file:// base. Pass a relative
    // path string instead so readFile resolves it against cwd (project root).
    const source = await readFile("src/lib/terminal-service.ts", "utf-8");
    expect(source).not.toContain('from "../extensions/preview"');
    expect(source).not.toMatch(/getSupportedExtensions\s*\(/);
    expect(source).toContain("getRegisteredFileExtensions");
    expect(source).toContain('from "./services/context-menu-item-registry"');
  });
});

describe("terminal-service link-click dispatch", () => {
  it("invokes the first matching context-menu handler directly, without pendingAction", async () => {
    const source = await readFile("src/lib/terminal-service.ts", "utf-8");
    // The old dispatch went through pendingAction:
    expect(source).not.toContain('"open-preview"');
    // The new dispatch invokes the registry handler directly:
    expect(source).toContain("getContextMenuItemsForFile");
  });
});
