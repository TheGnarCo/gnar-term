import { mount, unmount, type Component } from "svelte";
import DOMPurify from "dompurify";
import { registerPreviewer } from "../../services/preview-registry";
import { parseMarkdownChunks } from "../../markdown/render";
import {
  getMarkdownComponent,
  markdownComponentStore,
} from "../../services/markdown-component-registry";
import { getExtensionApiById } from "../../services/extension-loader";
import { EXTENSION_API_KEY } from "../../extension-types";
import "github-markdown-css/github-markdown-dark.css";

/**
 * Tracks live Svelte mounts per host element so re-renders (file change,
 * hot-reload) can tear down the previous mounts before mounting the new
 * chunk components — without leaking detached component instances.
 *
 * Svelte's mount() returns a record of exports keyed by string; unmount()
 * accepts the same value. Typed as Record<string, any> so unmount() is
 * happy on TS strict mode without an `as any` at every call site.
 */
type SvelteMountInstance = Record<string, unknown>;
const elementMounts = new WeakMap<HTMLElement, SvelteMountInstance[]>();
/** Per-element unsubscribe for the markdown-component-store re-render bridge. */
const elementUnsubs = new WeakMap<HTMLElement, () => void>();
/** Most recently rendered content per element — used by the store-driven
 *  re-render to avoid re-reading from disk. */
const elementContent = new WeakMap<HTMLElement, string>();

function disposeMounts(element: HTMLElement): void {
  const mounts = elementMounts.get(element);
  if (!mounts) return;
  for (const m of mounts) {
    try {
      void unmount(m);
    } catch {
      // unmount can throw if the component already torn down — ignore.
    }
  }
  elementMounts.set(element, []);
}

function renderChunks(content: string, element: HTMLElement): void {
  disposeMounts(element);
  element.classList.add("markdown-body");
  element.replaceChildren();
  element.style.display = "flex";
  element.style.flexDirection = "column";
  element.style.gap = "16px";

  const chunks = parseMarkdownChunks(content);
  const mounts: SvelteMountInstance[] = [];

  for (const chunk of chunks) {
    if (chunk.kind === "markdown") {
      const div = document.createElement("div");
      div.className = "markdown-body";
      div.setAttribute("data-meta-surface-chunk", "markdown");
      // parseMarkdownChunks already runs DOMPurify; sanitize again as
      // defense in depth so any future change to the upstream pipeline
      // can't smuggle script through here.
      div.innerHTML = DOMPurify.sanitize(chunk.html);
      element.appendChild(div);
      continue;
    }

    // widget chunk
    if (chunk.error) {
      const errDiv = document.createElement("div");
      errDiv.setAttribute("data-meta-surface-chunk", "widget-error");
      errDiv.setAttribute("data-widget-name", chunk.name);
      errDiv.style.cssText =
        "border: 1px solid #f85149; border-radius: 4px; padding: 12px; font-family: monospace; font-size: 12px; color: #f85149;";
      const title = document.createElement("div");
      title.style.cssText = "font-weight: 600; margin-bottom: 6px;";
      title.textContent = `Widget config error in gnar:${chunk.name}: ${chunk.error}`;
      const pre = document.createElement("pre");
      pre.style.cssText = "margin: 0; white-space: pre-wrap; opacity: 0.85;";
      pre.textContent = chunk.raw;
      errDiv.appendChild(title);
      errDiv.appendChild(pre);
      element.appendChild(errDiv);
      continue;
    }

    const widget = getMarkdownComponent(chunk.name);
    if (!widget) {
      const fallback = document.createElement("div");
      fallback.setAttribute("data-meta-surface-chunk", "widget-unknown");
      fallback.setAttribute("data-widget-name", chunk.name);
      fallback.style.cssText =
        "border: 1px dashed #666; border-radius: 4px; padding: 12px; font-family: monospace; font-size: 12px; color: #888;";
      const title = document.createElement("div");
      title.style.cssText = "font-weight: 600; margin-bottom: 6px;";
      title.textContent = `Unknown widget: gnar:${chunk.name}`;
      const pre = document.createElement("pre");
      pre.style.cssText = "margin: 0; white-space: pre-wrap; opacity: 0.7;";
      pre.textContent = chunk.raw;
      fallback.appendChild(title);
      fallback.appendChild(pre);
      element.appendChild(fallback);
      continue;
    }

    const host = document.createElement("div");
    host.setAttribute("data-meta-surface-chunk", "widget");
    host.setAttribute("data-widget-name", chunk.name);
    element.appendChild(host);
    try {
      // Widgets use getContext(EXTENSION_API_KEY) to reach theme/state/etc.
      // mount() doesn't inherit any host Svelte tree's context, so inject
      // the owning extension's API here keyed on widget.source. Core-built
      // widgets (source === "core") may not have an API entry; in that
      // case the Map is empty and the widget should degrade gracefully.
      const extApi = getExtensionApiById(widget.source);
      const context = new Map<unknown, unknown>();
      if (extApi) context.set(EXTENSION_API_KEY, extApi);
      const instance = mount(widget.component as Component, {
        target: host,
        props: chunk.config,
        context,
      });
      mounts.push(instance);
    } catch (err) {
      host.textContent = `Failed to mount widget gnar:${chunk.name}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  elementMounts.set(element, mounts);
}

registerPreviewer({
  extensions: ["md", "markdown", "mdx"],
  render(content, _filePath, element) {
    elementContent.set(element, content);
    renderChunks(content, element);

    // Subscribe to markdown-component registry changes the first time we render
    // into this element. When a component registers/unregisters, re-render
    // so newly-available widgets pop in (or fallbacks replace removed ones)
    // without requiring a file save.
    if (!elementUnsubs.has(element)) {
      let initial = true;
      const unsub = markdownComponentStore.subscribe(() => {
        if (initial) {
          initial = false;
          return;
        }
        const last = elementContent.get(element);
        if (typeof last === "string") {
          renderChunks(last, element);
        }
      });
      elementUnsubs.set(element, unsub);
    }
  },
});
