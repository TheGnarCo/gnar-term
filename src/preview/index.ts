/**
 * Preview System — modular file preview in tabs
 * 
 * Each previewer registers file extensions it handles.
 * Usage: const surface = await openPreview("/path/to/file.md");
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { themeProxy as theme } from "../lib/theme-accessor";

// --- Preview interface ---

export interface PreviewSurface {
  id: string;
  filePath: string;
  title: string;
  element: HTMLElement;
  watchId: number;
  dispose?: () => void;
}

export interface Previewer {
  extensions: string[];
  render(content: string, filePath: string, element: HTMLElement): void;
}

// --- Registry ---

const previewers: Previewer[] = [];

export function registerPreviewer(previewer: Previewer) {
  previewers.push(previewer);
}

export function canPreview(filePath: string): boolean {
  const ext = getExtension(filePath);
  return previewers.some(p => p.extensions.includes(ext));
}

export function getSupportedExtensions(): string[] {
  return previewers.flatMap(p => p.extensions);
}

// --- Open a preview surface ---

export async function openPreview(filePath: string): Promise<PreviewSurface> {
  const ext = getExtension(filePath);
  const previewer = previewers.find(p => p.extensions.includes(ext));
  
  if (!previewer) {
    throw new Error(`No previewer registered for .${ext}`);
  }

  const id = `preview-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const fileName = filePath.split("/").pop() || filePath;

  const element = document.createElement("div");
  element.style.cssText = `
    flex: 1; overflow-y: auto; padding: 24px 32px;
    background: ${theme.bg}; color: ${theme.fg};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 14px; line-height: 1.6;
    display: block; min-height: 0;
  `;
  element.className = "preview-surface";

  // Inject base preview styles once
  injectStyles();

  // Binary formats (pdf, image, video) read files themselves — skip text read
  const binaryExts = new Set(["pdf", "png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "heic", "heif", "tiff", "tif", "avif", "mp4", "webm", "mov", "avi", "mkv", "m4v", "ogv"]);
  const isBinary = binaryExts.has(ext);

  let content = "";
  if (!isBinary) {
    try {
      content = await invoke<string>("read_file", { path: filePath });
    } catch (err) {
      content = `Error reading file: ${err}`;
    }
  }

  renderWithChrome(previewer, content, filePath, element);

  // Watch for changes (text formats only — binary previewers handle their own reload)
  let watchId = 0;
  if (!isBinary) {
    try {
      watchId = await invoke<number>("watch_file", { path: filePath });
      await listen<{ watch_id: number; content: string }>("file-changed", (event) => {
        if (event.payload.watch_id === watchId) {
          renderWithChrome(previewer, event.payload.content, filePath, element);
        }
      });
    } catch {}
  }

  return { id, filePath, title: fileName, element, watchId };
}

// --- Content-based preview (no file backing) ---

export function openPreviewFromContent(
  content: string,
  title: string,
  previewId?: string,
): PreviewSurface {
  const id = previewId ?? `preview-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const element = document.createElement("div");
  element.style.cssText = `
    flex: 1; overflow-y: auto; padding: 24px 32px;
    background: ${theme.bg}; color: ${theme.fg};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 14px; line-height: 1.6;
    display: block; min-height: 0;
  `;
  element.className = "preview-surface";

  injectStyles();

  const mdPreviewer = previewers.find(p => p.extensions.includes("md"));
  if (mdPreviewer) {
    mdPreviewer.render(content, "", element);
  } else {
    element.textContent = content;
  }

  return { id, filePath: "", title, element, watchId: 0 };
}

// --- Helpers ---

function getExtension(path: string): string {
  const parts = path.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

function renderWithChrome(previewer: Previewer, content: string, filePath: string, element: HTMLElement) {
  // Just render the content directly — the path is already in the tab title
  previewer.render(content, filePath, element);
}

function injectStyles() {
  let style = document.getElementById("preview-styles") as HTMLStyleElement | null;
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

// Re-inject styles when theme changes (themeProxy reads current theme on access)
export function refreshPreviewStyles() {
  injectStyles();
}
