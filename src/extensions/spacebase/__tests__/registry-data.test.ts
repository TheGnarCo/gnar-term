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
