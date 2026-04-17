/**
 * Tests for the extension context menu item registry.
 *
 * Extensions register context menu items with file-type matchers.
 * The registry resolves which items apply to a given file context.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  registerContextMenuItem,
  unregisterContextMenuItemsBySource,
  getContextMenuItemsForFile,
  getContextMenuItemsForDir,
  contextMenuItemStore,
  resetContextMenuItems,
  validateWhenPattern,
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
