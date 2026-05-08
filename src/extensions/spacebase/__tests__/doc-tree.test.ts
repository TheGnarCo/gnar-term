/**
 * Tests buildDocTree — pins the folder/leaf nesting and the
 * folders-before-files / case-insensitive sort that drives the
 * collapsible registry view.
 */
import { describe, it, expect } from "vitest";
import { buildDocTree } from "../doc-tree";

describe("buildDocTree", () => {
  it("nests segments and groups folders before leaves", () => {
    const tree = buildDocTree([
      { path: "README.md", data: 1 },
      { path: "docs/intro.md", data: 2 },
      { path: "docs/api/v1.md", data: 3 },
      { path: "docs/api/v2.md", data: 4 },
    ]);
    expect(tree).toHaveLength(2);
    expect(tree[0]).toMatchObject({
      kind: "folder",
      name: "docs",
      path: "docs",
    });
    expect(tree[1]).toMatchObject({
      kind: "leaf",
      name: "README.md",
      path: "README.md",
    });

    const docs = tree[0]!;
    if (docs.kind !== "folder") throw new Error("expected folder");
    expect(docs.children).toHaveLength(2);
    expect(docs.children[0]).toMatchObject({
      kind: "folder",
      name: "api",
      path: "docs/api",
    });
    expect(docs.children[1]).toMatchObject({
      kind: "leaf",
      name: "intro.md",
      path: "docs/intro.md",
    });

    const api = docs.children[0]!;
    if (api.kind !== "folder") throw new Error("expected folder");
    expect(api.children.map((c) => c.path)).toEqual([
      "docs/api/v1.md",
      "docs/api/v2.md",
    ]);
  });

  it("sorts case-insensitively at every level", () => {
    const tree = buildDocTree([
      { path: "Zebra.md", data: 0 },
      { path: "apple.md", data: 0 },
      { path: "Banana.md", data: 0 },
    ]);
    expect(tree.map((n) => n.name)).toEqual([
      "apple.md",
      "Banana.md",
      "Zebra.md",
    ]);
  });

  it("trims leading/trailing slashes and skips empty paths", () => {
    const tree = buildDocTree([
      { path: "/foo/bar.md/", data: 1 },
      { path: "", data: 2 },
      { path: "/", data: 3 },
    ]);
    expect(tree).toHaveLength(1);
    const foo = tree[0]!;
    if (foo.kind !== "folder") throw new Error("expected folder");
    expect(foo.path).toBe("foo");
    expect(foo.children).toEqual([
      { kind: "leaf", name: "bar.md", path: "foo/bar.md", data: 1 },
    ]);
  });

  it("preserves leaf data through nesting", () => {
    type Doc = { id: string; title: string };
    const tree = buildDocTree<Doc>([
      { path: "x/y.md", data: { id: "a", title: "Y" } },
    ]);
    const x = tree[0]!;
    if (x.kind !== "folder") throw new Error("expected folder");
    const leaf = x.children[0]!;
    if (leaf.kind !== "leaf") throw new Error("expected leaf");
    expect(leaf.data).toEqual({ id: "a", title: "Y" });
  });
});
