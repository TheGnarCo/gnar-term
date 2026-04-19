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
import {
  openPreview,
  refreshPreviewStyles,
  renderContentToElement,
} from "./preview-service";
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

    // MCP tool: create a preview surface from in-memory content. The preview
    // extension owns this tool — core MCP has generic open_surface, and the
    // preview-specific shortcut lives here alongside the rest of the preview
    // pipeline. Preserves main's `create_preview` contract so external agents
    // that call it by name continue to work.
    api.registerMcpTool("create_preview", {
      description:
        "Open a preview surface with markdown/text/code content. Opens in the active pane of the bound (or specified) workspace.",
      inputSchema: {
        type: "object",
        properties: {
          content: { type: "string" },
          format: { type: "string", enum: ["markdown", "text", "code"] },
          language: { type: "string" },
          title: { type: "string" },
          workspace_id: { type: "string" },
        },
        required: ["content", "format"],
      },
      handler: (args) => {
        const p = args as {
          content: string;
          format: "markdown" | "text" | "code";
          language?: string;
          title?: string;
          workspace_id?: string;
        };
        if (p.workspace_id) api.switchWorkspace(p.workspace_id);
        const element = renderContentToElement(
          p.content,
          p.format,
          p.language ?? "",
          api,
        );
        const title = p.title ?? "Preview";
        api.openSurface("preview", title, {
          filePath: "",
          element,
          watchId: 0,
        });
        return { ok: true, title };
      },
    });
  });
}
