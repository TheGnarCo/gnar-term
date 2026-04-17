/**
 * Preview Service — file reading, rendering, and live watching.
 *
 * Extension-owned logic for opening file previews. Uses the local
 * preview-registry for content type detection and rendering.
 *
 * All Tauri and theme access flows through the ExtensionAPI — this module
 * never imports from @tauri-apps or core stores directly.
 */

import type { ExtensionAPI } from "../api";
import {
  findPreviewer,
  type PreviewContext,
  type PreviewResult,
} from "./preview-registry";
import { get } from "svelte/store";

export async function openPreview(
  filePath: string,
  api: ExtensionAPI,
): Promise<PreviewResult> {
  const ext = getExtension(filePath);
  const previewer = findPreviewer(filePath);

  if (!previewer) {
    throw new Error(`No previewer registered for .${ext}`);
  }

  const id = `preview-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const fileName = filePath.split("/").pop() || filePath;

  const themeValue = get(api.theme);

  const element = document.createElement("div");
  element.style.cssText = `
    flex: 1; overflow-y: auto; padding: 24px 32px;
    background: ${themeValue.bg}; color: ${themeValue.fg};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 14px; line-height: 1.6;
    display: block; min-height: 0;
  `;
  element.className = "preview-surface";

  injectStyles(api);

  const ctx = buildPreviewContext(api);

  const binaryExts = new Set([
    "pdf",
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "svg",
    "ico",
    "bmp",
    "heic",
    "heif",
    "tiff",
    "tif",
    "avif",
    "mp4",
    "webm",
    "mov",
    "avi",
    "mkv",
    "m4v",
    "ogv",
  ]);
  const isBinary = binaryExts.has(ext);

  let content = "";
  if (!isBinary) {
    try {
      content = await api.invoke<string>("read_file", { path: filePath });
    } catch (err) {
      content = `Error reading file: ${err}`;
    }
  }

  previewer.render(content, filePath, element, ctx);

  let watchId = 0;
  if (!isBinary) {
    try {
      watchId = await api.invoke<number>("watch_file", { path: filePath });
      api.onFileChanged(watchId, (event) => {
        previewer.render(event.content, filePath, element, ctx);
      });
    } catch {}
  }

  return { id, filePath, title: fileName, element, watchId };
}

/** Build a PreviewContext from the extension API for passing to previewers. */
function buildPreviewContext(api: ExtensionAPI): PreviewContext {
  const themeValue = get(api.theme);
  return {
    theme: themeValue as unknown as PreviewContext["theme"],
    convertFileSrc: api.convertFileSrc,
    invoke: api.invoke.bind(api),
  };
}

function injectStyles(api: ExtensionAPI) {
  const theme = get(api.theme) as unknown as PreviewContext["theme"];
  let style = document.getElementById(
    "preview-styles",
  ) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "preview-styles";
    document.head.appendChild(style);
  }
  style.textContent = `
    .preview-surface .json-key { color: ${theme.ansi.blue}; }
    .preview-surface .json-string { color: ${theme.ansi.green}; }
    .preview-surface .json-number { color: ${theme.ansi.magenta}; }
    .preview-surface .json-boolean { color: ${theme.ansi.yellow}; }
    .preview-surface .json-null { color: ${theme.fgDim}; }
    .preview-surface img { max-width: 100%; border-radius: 4px; }
  `;
}

export function refreshPreviewStyles(api: ExtensionAPI) {
  injectStyles(api);
}

/**
 * Render in-memory content (markdown/text/code) into a styled preview element.
 * Called by PreviewSurface.svelte when the MCP `create_preview` tool opens an
 * extension surface with a `{ content, format, language }` prop set rather
 * than a filePath. Kept inside the preview extension (uses the extension's
 * own previewer registry and the caller's ExtensionAPI for theme access) so
 * core code never needs to reach across the extension barrier.
 */
export function renderContentToElement(
  content: string,
  format: "markdown" | "text" | "code",
  language: string,
  api: ExtensionAPI,
): HTMLElement {
  const themeValue = get(api.theme);

  const element = document.createElement("div");
  element.style.cssText = `
    flex: 1; overflow-y: auto; padding: 24px 32px;
    background: ${themeValue.bg}; color: ${themeValue.fg};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 14px; line-height: 1.6;
    display: block; min-height: 0;
  `;
  element.className = "preview-surface";

  injectStyles(api);

  // Wrap text/code as fenced markdown so the markdown previewer handles
  // monospacing and syntax highlighting in one place.
  let rendered: string;
  if (format === "markdown") {
    rendered = content;
  } else if (format === "code") {
    rendered = "```" + language + "\n" + content + "\n```";
  } else {
    rendered = "```\n" + content + "\n```";
  }

  const mdPreviewer = findPreviewer("stub.md");
  if (mdPreviewer) {
    mdPreviewer.render(rendered, "", element, buildPreviewContext(api));
  } else {
    element.textContent = content;
  }
  return element;
}

function getExtension(path: string): string {
  const parts = path.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

export { type PreviewResult } from "./preview-registry";
