/**
 * URL-dispatch behavior for the preview pipeline.
 *
 * Covers the two pieces added by the `--preview` CLI flag + terminal-URL
 * click interception:
 *
 *   1. parsePreviewTarget — the small router that picks "path" vs "url"
 *      based on the leading scheme. file:// URLs decode into a local path;
 *      http(s):// URLs flow to the fetch branch; everything else is a path.
 *
 *   2. openPreview(url) — when given a URL, fetches the body, picks
 *      markdown vs plain-text rendering, sets the title from the cleaned
 *      URL, and rejects oversized / failing responses.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock("../lib/stores/theme", () => {
  const themeValue = {
    bg: "#000",
    fg: "#fff",
    fgDim: "#888",
    bgSurface: "#111",
    bgHighlight: "#222",
    border: "#333",
    ansi: {
      blue: "#00f",
      green: "#0f0",
      magenta: "#f0f",
      yellow: "#ff0",
      red: "#f00",
      cyan: "#0ff",
      white: "#fff",
      black: "#000",
    },
  };
  return {
    theme: {
      subscribe: (fn: (v: typeof themeValue) => void) => {
        fn(themeValue);
        return () => {};
      },
    },
  };
});

import { clearPreviewers } from "../lib/services/preview-registry";
import {
  openPreview,
  parsePreviewTarget,
} from "../lib/services/preview-service";

beforeAll(async () => {
  clearPreviewers();
  await import("../lib/preview/previewers/markdown");
  await import("../lib/preview/previewers/text");
});

beforeEach(() => {
  vi.restoreAllMocks();
});

// ─── parsePreviewTarget ───────────────────────────────────────────

describe("parsePreviewTarget", () => {
  it("returns kind:path for a bare local path", () => {
    expect(parsePreviewTarget("/tmp/file.md")).toEqual({
      kind: "path",
      path: "/tmp/file.md",
    });
  });

  it("returns kind:path for a relative path", () => {
    expect(parsePreviewTarget("docs/readme.md")).toEqual({
      kind: "path",
      path: "docs/readme.md",
    });
  });

  it("strips the file:// scheme and returns kind:path", () => {
    expect(parsePreviewTarget("file:///Users/me/notes.md")).toEqual({
      kind: "path",
      path: "/Users/me/notes.md",
    });
  });

  it("decodes percent-encoded characters in file:// paths", () => {
    expect(parsePreviewTarget("file:///tmp/with%20space.md")).toEqual({
      kind: "path",
      path: "/tmp/with space.md",
    });
  });

  it("returns kind:url for http URLs", () => {
    expect(parsePreviewTarget("http://example.com/x.md")).toEqual({
      kind: "url",
      url: "http://example.com/x.md",
    });
  });

  it("returns kind:url for https URLs", () => {
    expect(parsePreviewTarget("https://example.com/x.md")).toEqual({
      kind: "url",
      url: "https://example.com/x.md",
    });
  });

  it("preserves query and fragment in URL targets", () => {
    expect(parsePreviewTarget("https://example.com/api?x=1#frag")).toEqual({
      kind: "url",
      url: "https://example.com/api?x=1#frag",
    });
  });
});

// ─── openPreview(url) — fetch branch ──────────────────────────────

describe("openPreview — URL dispatch", () => {
  function mockFetch(
    body: string,
    init: {
      ok?: boolean;
      status?: number;
      statusText?: string;
      contentType?: string;
      contentLength?: string;
    } = {},
  ) {
    const headers = new Map<string, string>();
    if (init.contentType) headers.set("content-type", init.contentType);
    if (init.contentLength) headers.set("content-length", init.contentLength);
    return vi.fn().mockResolvedValue({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      statusText: init.statusText ?? "OK",
      headers: {
        get: (k: string) => headers.get(k.toLowerCase()) ?? null,
      },
      text: async () => body,
    });
  }

  it("fetches the URL and returns a PreviewResult with filePath = url", async () => {
    vi.stubGlobal("fetch", mockFetch("# hi", { contentType: "text/markdown" }));

    const result = await openPreview("https://example.com/readme.md");

    expect(result.filePath).toBe("https://example.com/readme.md");
    expect(result.id).toMatch(/^preview-/);
    expect(result.element).toBeInstanceOf(HTMLElement);
    expect(result.watchId).toBe(0);
  });

  it("titles the preview from the trailing URL path segment", async () => {
    vi.stubGlobal("fetch", mockFetch("# hi", { contentType: "text/plain" }));

    const result = await openPreview("https://example.com/docs/notes.md");
    expect(result.title).toBe("notes.md");
  });

  it("strips query string and fragment when deriving the title", async () => {
    vi.stubGlobal("fetch", mockFetch("# hi", { contentType: "text/plain" }));

    const result = await openPreview(
      "https://example.com/docs/notes.md?ref=abc#frag",
    );
    expect(result.title).toBe("notes.md");
  });

  it("renders as markdown when content-type says so", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch("# Heading", { contentType: "text/markdown; charset=utf-8" }),
    );

    const result = await openPreview("https://example.com/anything");
    // Markdown previewer emits an <h1> for `# Heading`.
    expect(result.element.querySelector("h1")).not.toBeNull();
  });

  it("renders as markdown when the URL path ends in .md", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch("# Heading", { contentType: "text/plain" }),
    );

    const result = await openPreview("https://example.com/readme.md");
    expect(result.element.querySelector("h1")).not.toBeNull();
  });

  it("renders as plain text (fenced) when neither header nor extension says markdown", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch("hello world", { contentType: "text/plain" }),
    );

    const result = await openPreview("https://example.com/raw");
    // Plain-text branch wraps content in a fenced code block; the markdown
    // previewer renders that to <pre><code> rather than an <h1>.
    expect(result.element.querySelector("h1")).toBeNull();
    expect(result.element.textContent).toContain("hello world");
  });

  it("throws when the response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch("nope", { ok: false, status: 404, statusText: "Not Found" }),
    );

    await expect(openPreview("https://example.com/missing")).rejects.toThrow(
      /404/,
    );
  });

  it("rejects oversized responses via content-length", async () => {
    const tooBig = String(6 * 1024 * 1024);
    vi.stubGlobal(
      "fetch",
      mockFetch("ignored", {
        contentType: "text/plain",
        contentLength: tooBig,
      }),
    );

    await expect(openPreview("https://example.com/big")).rejects.toThrow(
      /too large/i,
    );
  });
});
