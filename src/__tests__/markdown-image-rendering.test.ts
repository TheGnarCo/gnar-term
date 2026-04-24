import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PreviewContext } from "../lib/services/preview-registry";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((p: string) => `asset://localhost${p}`),
}));
vi.mock("dompurify", () => ({
  default: { sanitize: (s: string) => s },
}));
vi.mock("../lib/services/markdown-component-registry", () => ({
  getMarkdownComponent: vi.fn().mockReturnValue(null),
  markdownComponentStore: {
    subscribe: vi.fn((fn: (value: unknown) => void) => {
      fn([]);
      return () => {};
    }),
  },
  unregisterMarkdownComponentsBySource: vi.fn(),
}));
vi.mock("../lib/services/preview-surface-registry", () => ({
  getPreviewSurfaceById: vi.fn().mockReturnValue(null),
}));
vi.mock("github-markdown-css/github-markdown-dark.css", () => ({}));

describe("markdown image rendering", () => {
  beforeEach(async () => {
    const { clearPreviewers } =
      await import("../lib/services/preview-registry");
    clearPreviewers();
    // Re-import the previewer to re-register it
    vi.resetModules();
  });

  it("rewrites relative img srcs through convertFileSrc", async () => {
    await import("../lib/preview/previewers/markdown");
    const { getPreviewers } = await import("../lib/services/preview-registry");
    const previewer = getPreviewers().find((p) => p.extensions.includes("md"));
    expect(previewer).toBeDefined();

    const mockCtx = {
      convertFileSrc: (path: string) => `asset://localhost${path}`,
      invoke: vi.fn(),
      theme: {} as PreviewContext["theme"],
    };

    const element = document.createElement("div");
    previewer!.render(
      "![photo](./images/photo.png)",
      "/home/user/notes/doc.md",
      element,
      mockCtx,
    );

    const img = element.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.src).toBe("asset://localhost/home/user/notes/images/photo.png");
  });

  it("leaves http(s) image srcs untouched", async () => {
    await import("../lib/preview/previewers/markdown");
    const { getPreviewers } = await import("../lib/services/preview-registry");
    const previewer = getPreviewers().find((p) => p.extensions.includes("md"));

    const mockCtx = {
      convertFileSrc: (path: string) => `asset://localhost${path}`,
      invoke: vi.fn(),
      theme: {} as PreviewContext["theme"],
    };

    const element = document.createElement("div");
    previewer!.render(
      "![remote](https://example.com/img.png)",
      "/home/user/notes/doc.md",
      element,
      mockCtx,
    );

    const img = element.querySelector("img");
    expect(img!.src).toBe("https://example.com/img.png");
  });
});
