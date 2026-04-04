/**
 * Markdown Viewer Surface
 * Renders markdown files in a tab with live-reload on file change.
 */

import { marked } from "marked";
import DOMPurify from "dompurify";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { theme } from "./theme";

export interface MarkdownSurface {
  id: string;
  type: "markdown";
  filePath: string;
  title: string;
  element: HTMLElement;
  watchId: number;
}

export async function createMarkdownSurface(filePath: string): Promise<MarkdownSurface> {
  const id = `md-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const element = document.createElement("div");
  element.style.cssText = `
    flex: 1; overflow-y: auto; padding: 24px 32px;
    background: ${theme.bg}; color: ${theme.fg};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 14px; line-height: 1.6;
  `;
  element.className = "markdown-viewer";

  // Inject markdown styles
  if (!document.getElementById("md-styles")) {
    const style = document.createElement("style");
    style.id = "md-styles";
    style.textContent = `
      .markdown-viewer h1 { font-size: 2em; font-weight: 600; border-bottom: 1px solid ${theme.border}; padding-bottom: 0.3em; margin: 0.67em 0; }
      .markdown-viewer h2 { font-size: 1.5em; font-weight: 600; border-bottom: 1px solid ${theme.border}; padding-bottom: 0.3em; margin: 1em 0 0.5em; }
      .markdown-viewer h3 { font-size: 1.25em; font-weight: 600; margin: 1em 0 0.5em; }
      .markdown-viewer h4 { font-size: 1em; font-weight: 600; margin: 1em 0 0.5em; }
      .markdown-viewer p { margin: 0.5em 0; }
      .markdown-viewer a { color: ${theme.accent}; text-decoration: none; }
      .markdown-viewer a:hover { text-decoration: underline; }
      .markdown-viewer code {
        background: ${theme.bgSurface}; padding: 0.2em 0.4em;
        border-radius: 4px; font-size: 0.9em;
        font-family: "JetBrainsMono Nerd Font Mono", Menlo, monospace;
      }
      .markdown-viewer pre {
        background: ${theme.bgSurface}; padding: 16px;
        border-radius: 8px; overflow-x: auto; margin: 1em 0;
        border: 1px solid ${theme.border};
      }
      .markdown-viewer pre code {
        background: none; padding: 0; font-size: 13px; line-height: 1.5;
      }
      .markdown-viewer blockquote {
        border-left: 3px solid ${theme.accent}; padding: 0.5em 1em;
        margin: 1em 0; color: ${theme.fgMuted};
      }
      .markdown-viewer ul, .markdown-viewer ol { padding-left: 2em; margin: 0.5em 0; }
      .markdown-viewer li { margin: 0.25em 0; }
      .markdown-viewer table { border-collapse: collapse; width: 100%; margin: 1em 0; }
      .markdown-viewer th, .markdown-viewer td {
        border: 1px solid ${theme.border}; padding: 8px 12px; text-align: left;
      }
      .markdown-viewer th { background: ${theme.bgSurface}; font-weight: 600; }
      .markdown-viewer hr { border: none; border-top: 1px solid ${theme.border}; margin: 2em 0; }
      .markdown-viewer img { max-width: 100%; border-radius: 4px; }
      .markdown-viewer .md-path {
        font-size: 12px; color: ${theme.fgDim}; margin-bottom: 16px;
        font-family: monospace; padding-bottom: 8px;
        border-bottom: 1px solid ${theme.border};
      }
    `;
    document.head.appendChild(style);
  }

  // Read file
  let content = "";
  try {
    content = await invoke<string>("read_file", { path: filePath });
  } catch (err) {
    content = `# Error\n\nCould not read file: \`${filePath}\`\n\n\`\`\`\n${err}\n\`\`\``;
  }

  const fileName = filePath.split("/").pop() || filePath;

  function render(md: string) {
    const html = DOMPurify.sanitize(marked.parse(md) as string);
    const escapedPath = filePath.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    element.innerHTML = `<div class="md-path">${escapedPath}</div>${html}`;
  }

  render(content);

  // Watch for changes
  let watchId = 0;
  try {
    watchId = await invoke<number>("watch_file", { path: filePath });
    await listen<{ watch_id: number; content: string }>("file-changed", (event) => {
      if (event.payload.watch_id === watchId) {
        render(event.payload.content);
      }
    });
  } catch {}

  return {
    id,
    type: "markdown",
    filePath,
    title: fileName,
    element,
    watchId,
  };
}
