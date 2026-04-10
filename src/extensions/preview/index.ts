/**
 * Preview — included extension
 *
 * Registers the file preview surface type and "Preview File..." command.
 * Initializes all previewer modules and subscribes to theme changes.
 */
import type {
  ExtensionManifest,
  ExtensionAPI,
} from "../../lib/extension-types";
import {
  refreshPreviewStyles,
  getSupportedExtensions,
} from "../../preview/index";
import PreviewSurface from "../../lib/components/PreviewSurface.svelte";

// Import all previewer modules (self-registering)
import "../../preview/markdown";
import "../../preview/json";
import "../../preview/image";
import "../../preview/pdf";
import "../../preview/csv";
import "../../preview/yaml";
import "../../preview/video";
import "../../preview/text";

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
    api.registerSurfaceType("preview", PreviewSurface);

    api.registerCommand("preview-file", async () => {
      const path = await api.showInputPrompt("Path to file");
      if (path) api.openFile(path);
    });

    api.registerContextMenuItem("open-as-preview", (filePath) => {
      api.openFile(filePath);
    });

    // Refresh preview styles when theme changes
    api.on("theme:changed", () => {
      refreshPreviewStyles();
    });
  });
}
