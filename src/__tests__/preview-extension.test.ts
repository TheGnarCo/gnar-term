/**
 * Tests for the preview included extension — validates that preview
 * registers itself as a surface type and command via the extension API.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import {
  previewManifest,
  registerPreviewExtension,
} from "../extensions/preview";
import {
  surfaceTypeStore,
  resetSurfaceTypes,
} from "../lib/services/surface-type-registry";
import { commandStore, resetCommands } from "../lib/services/command-registry";
import {
  contextMenuItemStore,
  getContextMenuItemsForFile,
  resetContextMenuItems,
} from "../lib/services/context-menu-item-registry";
import {
  registerExtension,
  activateExtension,
  resetExtensions,
} from "../lib/services/extension-loader";

describe("Preview included extension", () => {
  beforeEach(async () => {
    await resetExtensions();
    resetSurfaceTypes();
    resetCommands();
    resetContextMenuItems();
  });

  it("manifest has correct id and metadata", () => {
    expect(previewManifest.id).toBe("preview");
    expect(previewManifest.name).toBe("Preview");
    expect(previewManifest.included).toBe(true);
  });

  it("manifest declares a surface contribution", () => {
    expect(previewManifest.contributes?.surfaces).toEqual([
      { id: "preview", label: "Preview" },
    ]);
  });

  it("manifest declares a command contribution", () => {
    expect(previewManifest.contributes?.commands).toEqual([
      { id: "preview-file", title: "Preview File..." },
    ]);
  });

  it("registers surface type via API with namespaced id", async () => {
    registerExtension(previewManifest, registerPreviewExtension);
    await activateExtension("preview");
    const types = get(surfaceTypeStore);
    expect(types).toHaveLength(1);
    expect(types[0].id).toBe("preview:preview");
    expect(types[0].source).toBe("preview");
    expect(types[0].component).toBeTruthy();
  });

  it("registers command via API with namespaced id", async () => {
    registerExtension(previewManifest, registerPreviewExtension);
    await activateExtension("preview");
    const cmds = get(commandStore);
    const previewCmd = cmds.find((c) => c.id === "preview:preview-file");
    expect(previewCmd).toBeTruthy();
    expect(previewCmd!.title).toBe("Preview File...");
    expect(previewCmd!.source).toBe("preview");
  });

  it("registers context menu item for previewable files", async () => {
    registerExtension(previewManifest, registerPreviewExtension);
    await activateExtension("preview");

    const items = get(contextMenuItemStore);
    const previewItem = items.find((i) => i.id === "preview:open-as-preview");
    expect(previewItem).toBeTruthy();
    expect(previewItem!.label).toBe("Open as Preview");
    expect(previewItem!.source).toBe("preview");
  });

  it("context menu item matches markdown files but not .exe", async () => {
    registerExtension(previewManifest, registerPreviewExtension);
    await activateExtension("preview");

    expect(getContextMenuItemsForFile("readme.md")).toHaveLength(1);
    expect(getContextMenuItemsForFile("data.json")).toHaveLength(1);
    expect(getContextMenuItemsForFile("photo.png")).toHaveLength(1);
    expect(getContextMenuItemsForFile("app.exe")).toHaveLength(0);
  });
});
