import { describe, it, expect, vi } from "vitest";
import { walkMarkdownFiles, type DirEntry } from "../fs-walk";

function listDir(layout: Record<string, DirEntry[]>) {
  return vi.fn(async (path: string) => layout[path] ?? []);
}

describe("walkMarkdownFiles", () => {
  it("returns top-level .md files as relative paths", async () => {
    const list = listDir({
      "/root": [
        { name: "a.md", path: "/root/a.md", is_dir: false },
        { name: "readme.txt", path: "/root/readme.txt", is_dir: false },
      ],
    });
    expect(await walkMarkdownFiles("/root", list)).toEqual(["a.md"]);
  });

  it("recurses into subdirectories", async () => {
    const list = listDir({
      "/root": [
        { name: "a.md", path: "/root/a.md", is_dir: false },
        { name: "sub", path: "/root/sub", is_dir: true },
      ],
      "/root/sub": [
        { name: "b.md", path: "/root/sub/b.md", is_dir: false },
        { name: "deeper", path: "/root/sub/deeper", is_dir: true },
      ],
      "/root/sub/deeper": [
        { name: "c.md", path: "/root/sub/deeper/c.md", is_dir: false },
      ],
    });
    expect((await walkMarkdownFiles("/root", list)).sort()).toEqual([
      "a.md",
      "sub/b.md",
      "sub/deeper/c.md",
    ]);
  });

  it("skips files that don't end in .md (case-insensitive)", async () => {
    const list = listDir({
      "/root": [
        { name: "Note.MD", path: "/root/Note.MD", is_dir: false },
        { name: "doc.markdown", path: "/root/doc.markdown", is_dir: false },
        { name: "x.md", path: "/root/x.md", is_dir: false },
      ],
    });
    const files = await walkMarkdownFiles("/root", list);
    expect(files.sort()).toEqual(["Note.MD", "x.md"]);
  });

  it("returns an empty list if the root directory is empty", async () => {
    const list = listDir({ "/root": [] });
    expect(await walkMarkdownFiles("/root", list)).toEqual([]);
  });

  it("skips directories that fail to list (treated as empty)", async () => {
    const list = vi.fn(async (path: string) => {
      if (path === "/root") {
        return [
          { name: "ok.md", path: "/root/ok.md", is_dir: false },
          { name: "denied", path: "/root/denied", is_dir: true },
        ] as DirEntry[];
      }
      throw new Error("permission denied");
    });
    const files = await walkMarkdownFiles("/root", list);
    expect(files).toEqual(["ok.md"]);
  });
});
