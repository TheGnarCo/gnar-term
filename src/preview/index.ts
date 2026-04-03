/**
 * Preview System — modular file preview in tabs
 * 
 * Each previewer registers file extensions it handles.
 * Usage: const surface = await openPreview("/path/to/file.md");
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { theme } from "../theme";

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
  `;
  element.className = "preview-surface";

  // Inject base preview styles once
  injectStyles();

  // Read and render
  let content = "";
  try {
    content = await invoke<string>("read_file", { path: filePath });
  } catch (err) {
    content = `Error reading file: ${err}`;
  }

  renderWithChrome(previewer, content, filePath, element);

  // Watch for changes
  let watchId = 0;
  try {
    watchId = await invoke<number>("watch_file", { path: filePath });
    await listen<{ watch_id: number; content: string }>("file-changed", (event) => {
      if (event.payload.watch_id === watchId) {
        renderWithChrome(previewer, event.payload.content, filePath, element);
      }
    });
  } catch {}

  return { id, filePath, title: fileName, element, watchId };
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

let _stylesInjected = false;
function injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;

  const style = document.createElement("style");
  style.id = "preview-styles";
  style.textContent = `
    .preview-surface h1 { font-size: 2em; font-weight: 600; border-bottom: 1px solid ${theme.border}; padding-bottom: 0.3em; margin: 0 0 0.67em; }
    .preview-surface h2 { font-size: 1.5em; font-weight: 600; border-bottom: 1px solid ${theme.border}; padding-bottom: 0.3em; margin: 1em 0 0.5em; }
    .preview-surface h3 { font-size: 1.25em; font-weight: 600; margin: 1em 0 0.5em; }
    .preview-surface h4 { font-size: 1em; font-weight: 600; margin: 1em 0 0.5em; }
    .preview-surface p { margin: 0.5em 0; }
    .preview-surface a { color: ${theme.accent}; text-decoration: none; }
    .preview-surface a:hover { text-decoration: underline; }
    .preview-surface code {
      background: ${theme.bgSurface}; padding: 0.2em 0.4em;
      border-radius: 4px; font-size: 0.9em;
      font-family: "JetBrainsMono Nerd Font Mono", Menlo, monospace;
    }
    .preview-surface pre {
      background: ${theme.bgSurface}; padding: 16px;
      border-radius: 8px; overflow-x: auto; margin: 1em 0;
      border: 1px solid ${theme.border};
    }
    .preview-surface pre code { background: none; padding: 0; font-size: 13px; line-height: 1.5; }
    .preview-surface blockquote {
      border-left: 3px solid ${theme.accent}; padding: 0.5em 1em;
      margin: 1em 0; color: ${theme.fgMuted};
    }
    .preview-surface ul, .preview-surface ol { padding-left: 2em; margin: 0.5em 0; }
    .preview-surface li { margin: 0.25em 0; }
    .preview-surface table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    .preview-surface th, .preview-surface td {
      border: 1px solid ${theme.border}; padding: 8px 12px; text-align: left;
    }
    .preview-surface th { background: ${theme.bgSurface}; font-weight: 600; }
    .preview-surface hr { border: none; border-top: 1px solid ${theme.border}; margin: 2em 0; }
    .preview-surface img { max-width: 100%; border-radius: 4px; }
    .preview-surface .json-key { color: ${theme.ansi.blue}; }
    .preview-surface .json-string { color: ${theme.ansi.green}; }
    .preview-surface .json-number { color: ${theme.ansi.magenta}; }
    .preview-surface .json-boolean { color: ${theme.ansi.yellow}; }
    .preview-surface .json-null { color: ${theme.fgDim}; }
  `;
  document.head.appendChild(style);
}
