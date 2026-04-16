/**
 * Tests for the preview included extension — validates that preview
 * registers surface types, commands, and context menu items via the
 * extension API. The preview extension owns the full preview pipeline
 * (ADR-003) including the surface type, all previewers, and rendering.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

// Previewers self-register on import (via the extension's index.ts)
import {
  previewManifest,
  registerPreviewExtension,
  SUPPORTED_EXTENSIONS,
  getSupportedExtensions,
} from "..";
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

describe("Preview included extension", () => {
  beforeEach(async () => {
    await resetExtensions();
    resetCommands();
    resetContextMenuItems();
  });

  it("manifest has correct id and metadata", () => {
    expect(previewManifest.id).toBe("preview");
    expect(previewManifest.name).toBe("Preview");
    expect(previewManifest.included).toBe(true);
  });

  it("manifest declares a command contribution", () => {
    expect(previewManifest.contributes?.commands).toEqual([
      { id: "preview-file", title: "Preview File..." },
    ]);
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

  it("SUPPORTED_EXTENSIONS covers all registered previewers", () => {
    // Detect drift between the static SUPPORTED_EXTENSIONS list (used for
    // context menu `when` clauses) and the dynamically registered previewers
    // in src/extensions/preview/previewers/. If a new previewer is added
    // without updating preview-registry-list.ts, this test fails.
    const registeredExtensions = new Set(getSupportedExtensions());
    const extensionSet = new Set(SUPPORTED_EXTENSIONS);

    const missingInList = [...registeredExtensions].filter(
      (ext) => !extensionSet.has(ext),
    );
    expect(
      missingInList,
      `Registered previewers support these extensions but SUPPORTED_EXTENSIONS doesn't include them: ${missingInList.join(", ")}. Update src/extensions/preview/preview-registry-list.ts.`,
    ).toEqual([]);
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
