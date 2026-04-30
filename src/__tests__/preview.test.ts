import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: any) => {
    if (cmd === "read_file") {
      return `# Local file\n\npath was: ${args.path}`;
    }
    if (cmd === "watch_file") {
      return 0;
    }
    return undefined;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import "../preview/init";
import { openPreview, parsePreviewTarget } from "../preview/index";

describe("parsePreviewTarget", () => {
  it("plain absolute path → kind: path", () => {
    expect(parsePreviewTarget("/tmp/foo.md")).toEqual({
      kind: "path",
      path: "/tmp/foo.md",
    });
  });

  it("relative path → kind: path", () => {
    expect(parsePreviewTarget("./README.md")).toEqual({
      kind: "path",
      path: "./README.md",
    });
  });

  it("file:// URL → kind: path with scheme stripped", () => {
    expect(parsePreviewTarget("file:///tmp/foo.md")).toEqual({
      kind: "path",
      path: "/tmp/foo.md",
    });
  });

  it("file:// URL with percent-encoding decodes", () => {
    expect(parsePreviewTarget("file:///tmp/with%20space.md")).toEqual({
      kind: "path",
      path: "/tmp/with space.md",
    });
  });

  it("https URL → kind: url", () => {
    expect(parsePreviewTarget("https://example.com/foo.md")).toEqual({
      kind: "url",
      url: "https://example.com/foo.md",
    });
  });

  it("http URL → kind: url", () => {
    expect(parsePreviewTarget("http://example.com/foo")).toEqual({
      kind: "url",
      url: "http://example.com/foo",
    });
  });

  it("unknown scheme falls through as a path (plugins will dispatch later)", () => {
    expect(parsePreviewTarget("spacebase://R9qNOvRHbR0x")).toEqual({
      kind: "path",
      path: "spacebase://R9qNOvRHbR0x",
    });
  });
});

describe("openPreview", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("local path opens via the registered previewer", async () => {
    const surface = await openPreview("/tmp/foo.md");
    expect(surface.title).toBe("foo.md");
    expect(surface.filePath).toBe("/tmp/foo.md");
    expect(surface.element).toBeInstanceOf(HTMLElement);
  });

  it("file:// URL opens via the registered previewer", async () => {
    const surface = await openPreview("file:///tmp/foo.md");
    expect(surface.title).toBe("foo.md");
    expect(surface.filePath).toBe("/tmp/foo.md");
  });

  it("https URL fetches and renders as markdown when content-type is text/markdown", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "text/markdown" }),
      text: async () => "# Remote\n\nbody",
    } as any);

    const surface = await openPreview("https://example.com/notes");
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/notes", {
      redirect: "follow",
    });
    expect(surface.title).toBe("notes");
    // Markdown previewer rendered the content into the element
    expect(surface.element.textContent).toContain("Remote");
  });

  it("https URL renders as markdown when path ends in .md regardless of content-type", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "text/plain" }),
      text: async () => "# By extension",
    } as any);

    const surface = await openPreview("https://example.com/foo.md?ref=main");
    expect(surface.title).toBe("foo.md");
    expect(surface.element.textContent).toContain("By extension");
  });

  it("https URL with non-markdown content renders as code block", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "text/plain" }),
      text: async () => "plain text body",
    } as any);

    const surface = await openPreview("https://example.com/raw.txt");
    expect(surface.title).toBe("raw.txt");
    expect(surface.element.textContent).toContain("plain text body");
  });

  it("https URL throws if fetch fails", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: new Headers(),
      text: async () => "",
    } as any);

    await expect(openPreview("https://example.com/missing.md")).rejects.toThrow(
      /404/,
    );
  });

  it("https URL throws if content-length exceeds cap", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-length": String(20 * 1024 * 1024) }),
      text: async () => "",
    } as any);

    await expect(openPreview("https://example.com/huge.md")).rejects.toThrow(
      /too large/i,
    );
  });
});
