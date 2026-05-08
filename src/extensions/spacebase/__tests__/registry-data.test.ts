import { describe, it, expect, vi } from "vitest";
import { cachePathFor, openDocFlow } from "../registry-data";
import type { SpacebaseClient } from "../api-client";

describe("cachePathFor", () => {
  it("builds a path under ~/.gnar-term/spacebase/cache/{projectId}/{docId}.md", () => {
    expect(cachePathFor("/Users/me", "proj_1", "doc_1")).toBe(
      "/Users/me/.gnar-term/spacebase/cache/proj_1/doc_1.md",
    );
  });

  it("strips a trailing slash from the home path", () => {
    expect(cachePathFor("/Users/me/", "p", "d")).toBe(
      "/Users/me/.gnar-term/spacebase/cache/p/d.md",
    );
  });

  // Regression: server-supplied projectId/docId values flow into the
  // filesystem path. A hostile or buggy server must not be able to
  // escape the cache root. The guard rejects path separators, traversal
  // components, and empty segments outright.
  it.each([
    ["projectId with slash", "p/../../etc", "doc"],
    ["docId with slash", "p", "d/../../escape"],
    ["projectId with backslash", "p\\..", "d"],
    ["docId with NUL", "p", "d\u0000evil"],
    ["projectId is ..", "..", "d"],
    ["docId is .", "p", "."],
    ["empty projectId", "", "d"],
    ["empty docId", "p", ""],
  ])("rejects %s", (_label, projectId, docId) => {
    expect(() => cachePathFor("/Users/me", projectId, docId)).toThrow(
      /unsafe path segment|empty path segment/,
    );
  });
});

describe("openDocFlow", () => {
  function client(rawBody = "# Hi\n"): SpacebaseClient {
    return {
      me: vi.fn(),
      listDocs: vi.fn(),
      getDoc: vi.fn(),
      getDocRaw: vi.fn().mockResolvedValue(rawBody),
    };
  }

  it("fetches raw markdown, ensures the cache dir, writes the file, and opens a preview", async () => {
    const c = client("# Body\n");
    const ensureDir = vi.fn().mockResolvedValue(undefined);
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const openPreviewSplit = vi.fn();
    const getHome = vi.fn().mockResolvedValue("/Users/me");

    await openDocFlow(
      { client: c, ensureDir, writeFile, openPreviewSplit, getHome },
      "proj_x",
      "doc_y",
    );

    expect(c.getDocRaw).toHaveBeenCalledWith("proj_x", "doc_y");
    expect(ensureDir).toHaveBeenCalledWith(
      "/Users/me/.gnar-term/spacebase/cache/proj_x",
    );
    expect(writeFile).toHaveBeenCalledWith(
      "/Users/me/.gnar-term/spacebase/cache/proj_x/doc_y.md",
      "# Body\n",
    );
    expect(openPreviewSplit).toHaveBeenCalledWith(
      "/Users/me/.gnar-term/spacebase/cache/proj_x/doc_y.md",
    );
  });

  // Regression for the cachePathFor traversal guard wiring: openDocFlow
  // must reject hostile IDs before touching the filesystem. Otherwise a
  // malicious docId would still write through ensureDir+writeFile.
  it("rejects a path-traversal docId before touching the filesystem", async () => {
    const c = client();
    const ensureDir = vi.fn().mockResolvedValue(undefined);
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const openPreviewSplit = vi.fn();
    await expect(
      openDocFlow(
        {
          client: c,
          ensureDir,
          writeFile,
          openPreviewSplit,
          getHome: vi.fn().mockResolvedValue("/Users/me"),
        },
        "proj",
        "../../../.gnar-term/spacebase",
      ),
    ).rejects.toThrow(/unsafe path segment/);
    expect(writeFile).not.toHaveBeenCalled();
    expect(openPreviewSplit).not.toHaveBeenCalled();
  });

  it("propagates a getDocRaw failure (no preview opened)", async () => {
    const c: SpacebaseClient = {
      me: vi.fn(),
      listDocs: vi.fn(),
      getDoc: vi.fn(),
      getDocRaw: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const openPreviewSplit = vi.fn();
    await expect(
      openDocFlow(
        {
          client: c,
          ensureDir: vi.fn().mockResolvedValue(undefined),
          writeFile: vi.fn().mockResolvedValue(undefined),
          openPreviewSplit,
          getHome: vi.fn().mockResolvedValue("/Users/me"),
        },
        "p",
        "d",
      ),
    ).rejects.toThrow("boom");
    expect(openPreviewSplit).not.toHaveBeenCalled();
  });
});
