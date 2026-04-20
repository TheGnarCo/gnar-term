/**
 * Tests for the markdown previewer's markdown-component handling — verifies
 * that fenced ```gnar:<name>``` blocks are extracted from the markdown
 * source, looked up against the markdown-component registry, and rendered
 * appropriately (mounted Svelte component, unknown-name fallback,
 * config-error fallback).
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { readable } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((p: string) => `asset://localhost/${p}`),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));
vi.mock("github-markdown-css/github-markdown-dark.css", () => ({}));

// Pre-import the markdown previewer so it self-registers via
// registerPreviewer() before any test calls findPreviewer.
beforeAll(async () => {
  await import("../lib/preview/previewers/markdown");
});

import { findPreviewer } from "../lib/services/preview-registry";
import {
  registerMarkdownComponent,
  resetMarkdownComponents,
} from "../lib/services/markdown-component-registry";
import type { PreviewContext } from "../lib/services/preview-registry";

const themeCtx = {
  bg: "#000",
  fg: "#fff",
  fgDim: "#888",
  bgSurface: "#111",
  bgHighlight: "#222",
  border: "#333",
  ansi: { blue: "#00f", green: "#0f0", magenta: "#f0f", yellow: "#ff0" },
} as unknown as PreviewContext["theme"];

const ctx: PreviewContext = {
  theme: themeCtx,
  convertFileSrc: (p) => p,
  invoke: vi.fn().mockResolvedValue(undefined),
};

describe("markdown previewer — markdown-component handling", () => {
  beforeEach(() => {
    resetMarkdownComponents();
  });

  it("renders plain markdown content as a markdown chunk", () => {
    const previewer = findPreviewer("notes.md")!;
    const el = document.createElement("div");
    previewer.render("# Hello\n\nWorld.", "/abs/notes.md", el, ctx);

    const chunks = el.querySelectorAll('[data-meta-surface-chunk="markdown"]');
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].textContent).toContain("Hello");
    expect(chunks[0].textContent).toContain("World");
  });

  it("renders an unknown-component fallback when the gnar:<name> isn't registered", () => {
    const previewer = findPreviewer("notes.md")!;
    const el = document.createElement("div");
    previewer.render(
      ["```gnar:nope", "x: 1", "```"].join("\n"),
      "/abs/x.md",
      el,
      ctx,
    );

    const fallback = el.querySelector(
      '[data-meta-surface-chunk="widget-unknown"]',
    );
    expect(fallback).not.toBeNull();
    expect(fallback?.getAttribute("data-widget-name")).toBe("nope");
    expect(fallback?.textContent).toContain("Unknown widget: gnar:nope");
  });

  it("renders an error chunk when YAML inside the directive fails to parse", () => {
    const previewer = findPreviewer("notes.md")!;
    const el = document.createElement("div");
    previewer.render(
      ["```gnar:broken", "key: value", "  bad: } { nested", "```"].join("\n"),
      "/abs/x.md",
      el,
      ctx,
    );

    const errChunk = el.querySelector(
      '[data-meta-surface-chunk="widget-error"]',
    );
    expect(errChunk).not.toBeNull();
    expect(errChunk?.getAttribute("data-widget-name")).toBe("broken");
    expect(errChunk?.textContent).toContain("Widget config error");
  });

  it("registers and mounts a Svelte component for a registered markdown-component", async () => {
    const StubWidget = (await import("./markdown-previewer-stub-widget.svelte"))
      .default;

    registerMarkdownComponent({
      name: "stub",
      component: StubWidget,
      source: "test",
    });

    const previewer = findPreviewer("notes.md")!;
    const el = document.createElement("div");
    previewer.render(
      ["# Top", "", "```gnar:stub", "label: hello", "count: 3", "```"].join(
        "\n",
      ),
      "/abs/x.md",
      el,
      ctx,
    );

    const widgetChunk = el.querySelector('[data-meta-surface-chunk="widget"]');
    expect(widgetChunk).not.toBeNull();
    expect(widgetChunk?.getAttribute("data-widget-name")).toBe("stub");

    const stubEl = widgetChunk?.querySelector("[data-stub-widget]");
    expect(stubEl).not.toBeNull();
    expect(stubEl?.getAttribute("data-label")).toBe("hello");
    expect(stubEl?.getAttribute("data-count")).toBe("3");
  });

  it("re-rendering with new content tears down previous mounts", async () => {
    const StubWidget = (await import("./markdown-previewer-stub-widget.svelte"))
      .default;

    registerMarkdownComponent({
      name: "stub",
      component: StubWidget,
      source: "test",
    });

    const previewer = findPreviewer("notes.md")!;
    const el = document.createElement("div");
    previewer.render(
      ["```gnar:stub", "label: first", "```"].join("\n"),
      "/abs/x.md",
      el,
      ctx,
    );

    const stub = el.querySelector("[data-stub-widget]");
    expect(stub?.getAttribute("data-label")).toBe("first");

    previewer.render(
      ["```gnar:stub", "label: second", "```"].join("\n"),
      "/abs/x.md",
      el,
      ctx,
    );

    const stubs = el.querySelectorAll("[data-stub-widget]");
    expect(stubs.length).toBe(1);
    expect(stubs[0].getAttribute("data-label")).toBe("second");
  });

  it("injects the owning extension's API into mounted widgets via context", async () => {
    const { registerExtension, activateExtension, resetExtensions } =
      await import("../lib/services/extension-loader");
    const CtxStub = (
      await import("./markdown-previewer-ctx-stub-widget.svelte")
    ).default;

    await resetExtensions();
    // Use a minimal manifest; the extension just needs an entry in the
    // extension loader's API registry so getExtensionApiById resolves.
    registerExtension(
      {
        id: "ctx-ext",
        name: "Ctx Ext",
        version: "0.0.1",
        entry: "./index.ts",
        included: true,
      },
      (_api) => {
        // Tag the API so the widget can prove it received *this* instance.
        (_api as unknown as Record<string, unknown>).marker = "ctx-ext-api";
      },
    );
    await activateExtension("ctx-ext");

    registerMarkdownComponent({
      name: "ctx-stub",
      component: CtxStub,
      source: "ctx-ext",
    });

    const previewer = findPreviewer("notes.md")!;
    const el = document.createElement("div");
    previewer.render(
      ["```gnar:ctx-stub", "```"].join("\n"),
      "/abs/x.md",
      el,
      ctx,
    );

    const stub = el.querySelector("[data-ctx-stub-widget]");
    expect(stub).not.toBeNull();
    expect(stub?.getAttribute("data-api-present")).toBe("yes");
    expect(stub?.getAttribute("data-api-marker")).toBe("ctx-ext-api");
  });

  it("injects DashboardHostContext from the nearest preview surface entry into mounted widgets", async () => {
    const HostStub = (
      await import("./markdown-previewer-host-stub-widget.svelte")
    ).default;
    const { registerPreviewSurface, resetPreviewSurfaceRegistry } =
      await import("../lib/services/preview-surface-registry");

    resetPreviewSurfaceRegistry();
    registerMarkdownComponent({
      name: "host-stub",
      component: HostStub,
      source: "test",
    });

    const previewer = findPreviewer("notes.md")!;
    // The mounted widget looks up the host via element.closest(...) on the
    // preview-surface marker element; the registry lookup reveals the
    // workspace's metadata, which gets routed into DashboardHostContext.
    const surface = document.createElement("div");
    surface.setAttribute("data-preview-surface-id", "surf-host-1");
    document.body.appendChild(surface);

    registerPreviewSurface({
      surfaceId: "surf-host-1",
      path: "/abs/x.md",
      paneId: "pane-host-1",
      workspaceId: "ws-host-1",
      hostMetadata: { groupId: "group-abc", isDashboard: true },
    });

    previewer.render(
      ["```gnar:host-stub", "```"].join("\n"),
      "/abs/x.md",
      surface,
      ctx,
    );

    const stub = surface.querySelector("[data-host-stub-widget]");
    expect(stub).not.toBeNull();
    expect(stub?.getAttribute("data-host-present")).toBe("yes");
    expect(stub?.getAttribute("data-host-group-id")).toBe("group-abc");
    expect(stub?.getAttribute("data-host-global")).toBe("no");

    document.body.removeChild(surface);
    resetPreviewSurfaceRegistry();
  });

  it("provides a null DashboardHostContext when widget is mounted outside any preview surface", async () => {
    const HostStub = (
      await import("./markdown-previewer-host-stub-widget.svelte")
    ).default;
    const { resetPreviewSurfaceRegistry } =
      await import("../lib/services/preview-surface-registry");
    resetPreviewSurfaceRegistry();

    registerMarkdownComponent({
      name: "host-stub",
      component: HostStub,
      source: "test",
    });

    const previewer = findPreviewer("notes.md")!;
    const el = document.createElement("div");
    // No data-preview-surface-id on ancestor chain; widget receives null host.
    previewer.render(
      ["```gnar:host-stub", "```"].join("\n"),
      "/abs/x.md",
      el,
      ctx,
    );

    const stub = el.querySelector("[data-host-stub-widget]");
    expect(stub?.getAttribute("data-host-present")).toBe("no");
  });

  // Imports for theme store / readable may be needed in the future;
  // suppress unused warnings without the dead-code optimizer trimming.
  void readable;
});
