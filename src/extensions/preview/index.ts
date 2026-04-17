/**
 * Preview — included extension
 *
 * Owns the complete preview pipeline: file type detection, content rendering,
 * surface type registration, and style management. Core has no knowledge of
 * preview functionality.
 *
 * Registers:
 * - "preview" surface type for rendering file previews
 * - "preview-file" command for the command palette
 * - "open-as-preview" context menu item for file browser
 * - Theme change listener for style refresh
 * - All content-type previewers (markdown, json, image, pdf, csv, yaml, video, text)
 */
import type { ExtensionManifest, ExtensionAPI } from "../api";
import { getSupportedExtensions } from "./preview-registry";
import { openPreview, refreshPreviewStyles } from "./preview-service";
import PreviewSurface from "./PreviewSurface.svelte";

// Import all previewers — they self-register via registerPreviewer()
import "./previewers/markdown";
import "./previewers/json";
import "./previewers/image";
import "./previewers/pdf";
import "./previewers/csv";
import "./previewers/yaml";
import "./previewers/video";
import "./previewers/text";

// Re-export for tests
export { SUPPORTED_EXTENSIONS } from "./preview-registry-list";
export { getSupportedExtensions } from "./preview-registry";
export { openPreviewFromContent } from "./preview-service";

export const previewManifest: ExtensionManifest = {
  id: "preview",
  name: "Preview",
  version: "0.1.0",
  description: "File preview (Markdown, JSON, images, and more)",
  entry: "./index.ts",
  included: true,
  contributes: {
    surfaces: [{ id: "preview", label: "Preview" }],
    commands: [{ id: "preview-file", title: "Preview File..." }],
    contextMenuItems: [
      {
        id: "open-as-preview",
        label: "Open as Preview",
        when: `*.{${getSupportedExtensions().join(",")}}`,
      },
    ],
    events: ["theme:changed"],
  },
};

export function registerPreviewExtension(api: ExtensionAPI): void {
  api.onActivate(() => {
    // Register the preview surface type — extension-owned, not core
    api.registerSurfaceType("preview", PreviewSurface);

    // Theme change → refresh preview styles
    api.on("theme:changed", () => {
      refreshPreviewStyles(api);
    });

    // Command palette: preview a file
    api.registerCommand("preview-file", async () => {
      const path = await api.showInputPrompt("Path to file");
      if (path) {
        const preview = await openPreview(path, api);
        api.openSurface("preview", preview.title, {
          filePath: preview.filePath,
          element: preview.element,
          watchId: preview.watchId,
        });
      }
    });

    // Context menu: open file as preview
    api.registerContextMenuItem("open-as-preview", async (filePath) => {
      const preview = await openPreview(filePath, api);
      api.openSurface("preview", preview.title, {
        filePath: preview.filePath,
        element: preview.element,
        watchId: preview.watchId,
      });
    });
  });
}
