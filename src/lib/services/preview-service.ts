/**
 * Preview Service — file reading, rendering, and live watching.
 *
 * Core-owned logic for opening file previews. The preview surface is a
 * first-class core surface kind (alongside terminal/extension); this
 * service owns the pipeline that turns a file path into a rendered
 * HTMLElement plus a watch handle so the surface re-renders on disk
 * changes.
 */

import { invoke as tauriInvoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { get } from "svelte/store";
import { theme } from "../stores/theme";
import {
  findPreviewer,
  type PreviewContext,
  type PreviewResult,
} from "./preview-registry";

const BINARY_EXTS = new Set([
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

function getExtension(path: string): string {
  const parts = path.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

function buildPreviewContext(): PreviewContext {
  const themeValue = get(theme);
  return {
    theme: themeValue as unknown as PreviewContext["theme"],
    convertFileSrc,
    invoke: tauriInvoke,
  };
}

function injectStyles(): void {
  const themeValue = get(theme) as unknown as PreviewContext["theme"];
  let style = document.getElementById(
    "preview-styles",
  ) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "preview-styles";
    document.head.appendChild(style);
  }
  style.textContent = `
    .preview-surface .json-key { color: ${themeValue.ansi.blue}; }
    .preview-surface .json-string { color: ${themeValue.ansi.green}; }
    .preview-surface .json-number { color: ${themeValue.ansi.magenta}; }
    .preview-surface .json-boolean { color: ${themeValue.ansi.yellow}; }
    .preview-surface .json-null { color: ${themeValue.fgDim}; }
    .preview-surface img { max-width: 100%; border-radius: 4px; }
  `;
}

export function refreshPreviewStyles(): void {
  injectStyles();
}

export async function openPreview(filePath: string): Promise<PreviewResult> {
  const ext = getExtension(filePath);
  const previewer = findPreviewer(filePath);

  if (!previewer) {
    throw new Error(`No previewer registered for .${ext}`);
  }

  const id = `preview-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const fileName = filePath.split("/").pop() || filePath;

  const themeValue = get(theme);

  const element = document.createElement("div");
  element.style.cssText = `
    flex: 1; overflow-y: auto; padding: 24px 32px;
    background: ${themeValue.bg}; color: ${themeValue.fg};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 14px; line-height: 1.6;
    display: block; min-height: 0;
  `;
  element.className = "preview-surface";

  injectStyles();

  const ctx = buildPreviewContext();
  const isBinary = BINARY_EXTS.has(ext);

  let content = "";
  if (!isBinary) {
    try {
      content = await tauriInvoke<string>("read_file", { path: filePath });
    } catch (err) {
      content = `Error reading file: ${err}`;
    }
  }

  previewer.render(content, filePath, element, ctx);

  let watchId = 0;
  if (!isBinary) {
    try {
      watchId = await tauriInvoke<number>("watch_file", { path: filePath });
      const unlisten = await listen<{
        watch_id: number;
        path: string;
        content: string;
      }>("file-changed", (event) => {
        if (event.payload.watch_id !== watchId) return;
        previewer.render(event.payload.content, filePath, element, ctx);
      });
      // Stash the unlisten so dispose can detach the listener; otherwise
      // each open leaks a permanent listener for the lifetime of the app.
      const result: PreviewResult = {
        id,
        filePath,
        title: fileName,
        element,
        watchId,
        dispose: () => {
          unlisten();
        },
      };
      return result;
    } catch {
      // No watch — fall through to return the static result below.
    }
  }

  return { id, filePath, title: fileName, element, watchId };
}

/**
 * Render in-memory content (markdown/text/code) into a styled preview
 * element. Called when a preview surface opens with `{ content, format,
 * language }` props instead of a file path — e.g. when an MCP client
 * invokes `create_preview` with raw content.
 */
export function renderContentToElement(
  content: string,
  format: "markdown" | "text" | "code",
  language: string,
): HTMLElement {
  const themeValue = get(theme);

  const element = document.createElement("div");
  element.style.cssText = `
    flex: 1; overflow-y: auto; padding: 24px 32px;
    background: ${themeValue.bg}; color: ${themeValue.fg};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 14px; line-height: 1.6;
    display: block; min-height: 0;
  `;
  element.className = "preview-surface";

  injectStyles();

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
    mdPreviewer.render(rendered, "", element, buildPreviewContext());
  } else {
    element.textContent = content;
  }
  return element;
}

export { type PreviewResult } from "./preview-registry";
