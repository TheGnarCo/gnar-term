import { mount, unmount, type Component } from "svelte";
import DOMPurify from "dompurify";
import {
  registerPreviewer,
  type PreviewContext,
} from "../../services/preview-registry";
import { parseMarkdownChunks } from "../../markdown/render";
import {
  getMarkdownComponent,
  markdownComponentStore,
} from "../../services/markdown-component-registry";
import { getExtensionApiById } from "../../services/extension-loader";
import { EXTENSION_API_KEY } from "../../extension-types";
import {
  DASHBOARD_HOST_KEY,
  type DashboardHostContext,
} from "../../contexts/dashboard-host";
import { getPreviewSurfaceById } from "../../services/preview-surface-registry";
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
const elementFilePaths = new WeakMap<HTMLElement, string>();
const elementCtxs = new WeakMap<HTMLElement, PreviewContext>();

/**
 * Look up the owning PreviewSurface for a widget mount target by walking
 * ancestor elements for the `data-preview-surface-id` marker and matching
 * it against the preview-surface registry. Returns null when the widget
 * is mounted outside any surface (e.g. a markdown preview rendered in a
 * test harness or a future embedder) so widgets can decide to render
 * empty / error state.
 */
function resolveDashboardHost(
  target: HTMLElement,
): DashboardHostContext | null {
  const surfaceEl = target.closest("[data-preview-surface-id]");
  const surfaceId = surfaceEl?.getAttribute("data-preview-surface-id") ?? "";
  if (!surfaceId) return null;
  const entry = getPreviewSurfaceById(surfaceId);
  if (!entry?.hostMetadata) return null;
  return { metadata: entry.hostMetadata };
}

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

function renderChunks(
  content: string,
  element: HTMLElement,
  filePath: string = "",
  ctx?: PreviewContext,
): void {
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
      if (ctx && filePath) {
        const dir = filePath.includes("/")
          ? filePath.substring(0, filePath.lastIndexOf("/"))
          : "";
        for (const img of div.querySelectorAll("img")) {
          const src = img.getAttribute("src");
          if (
            !src ||
            src.startsWith("http://") ||
            src.startsWith("https://") ||
            src.startsWith("asset://") ||
            src.startsWith("data:")
          )
            continue;
          const resolved = src.startsWith("/")
            ? src
            : dir
              ? `${dir}/${src}`
              : src;
          img.src = ctx.convertFileSrc(resolved);
        }
      }
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
      if (!extApi && widget.source !== "core") {
        console.warn(
          `[markdown] API not found for widget "${chunk.name}" (source: "${widget.source}") — context will not be injected`,
        );
      }
      const context = new Map<unknown, unknown>();
      if (extApi) context.set(EXTENSION_API_KEY, extApi);
      // Inject DashboardHostContext when the widget's target element sits
      // inside a PreviewSurface. Dashboard widgets (agent-list, kanban,
      // task-spawner) derive their scope from this context — see the
      // spec's §5.3 widget-scope-derivation rules.
      const dashboardHost = resolveDashboardHost(host);
      if (dashboardHost) context.set(DASHBOARD_HOST_KEY, dashboardHost);
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
  render(content, filePath, element, ctx) {
    elementContent.set(element, content);
    elementFilePaths.set(element, filePath);
    if (ctx) elementCtxs.set(element, ctx);
    renderChunks(content, element, filePath, ctx);

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
        const lastPath = elementFilePaths.get(element) ?? "";
        const lastCtx = elementCtxs.get(element);
        if (typeof last === "string") {
          renderChunks(last, element, lastPath, lastCtx);
        }
      });
      elementUnsubs.set(element, unsub);
    }
  },
});
