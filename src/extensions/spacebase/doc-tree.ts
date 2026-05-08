/**
 * Builds a folder tree out of a flat list of `/`-separated paths so the
 * Spacebase registry / workspace dashboard can render docs as
 * collapsible directories. Pure helper — no Svelte, easy to test.
 *
 * Folders sort before files at every level; both groups sort
 * case-insensitively by name. The full slash path of every node is
 * preserved on the node itself so callers can use it as the
 * expand-state key.
 */

export type DocTreeFolder<T> = {
  kind: "folder";
  name: string;
  /** Full slash path from the root, e.g. `"foo/bar"`. Empty string at the synthetic root. */
  path: string;
  children: DocTreeNode<T>[];
};

export type DocTreeLeaf<T> = {
  kind: "leaf";
  name: string;
  /** Full slash path from the root, e.g. `"foo/bar.md"`. */
  path: string;
  data: T;
};

export type DocTreeNode<T> = DocTreeFolder<T> | DocTreeLeaf<T>;

export interface DocTreeInput<T> {
  /** Slash-separated path. Trailing slashes are trimmed. */
  path: string;
  data: T;
}

/**
 * Returns the top-level children of the synthetic root. Items whose path
 * collapses to an empty string after trimming are dropped.
 */
export function buildDocTree<T>(items: DocTreeInput<T>[]): DocTreeNode<T>[] {
  const root: DocTreeFolder<T> = {
    kind: "folder",
    name: "",
    path: "",
    children: [],
  };

  for (const item of items) {
    const segments = item.path
      .split("/")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (segments.length === 0) continue;

    let cursor: DocTreeFolder<T> = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]!;
      const childPath = cursor.path ? `${cursor.path}/${seg}` : seg;
      let next = cursor.children.find(
        (c): c is DocTreeFolder<T> =>
          c.kind === "folder" && c.name === seg && c.path === childPath,
      );
      if (!next) {
        next = { kind: "folder", name: seg, path: childPath, children: [] };
        cursor.children.push(next);
      }
      cursor = next;
    }

    const leafName = segments[segments.length - 1]!;
    const leafPath = cursor.path ? `${cursor.path}/${leafName}` : leafName;
    cursor.children.push({
      kind: "leaf",
      name: leafName,
      path: leafPath,
      data: item.data,
    });
  }

  sortTree(root);
  return root.children;
}

function sortTree<T>(folder: DocTreeFolder<T>): void {
  folder.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  for (const child of folder.children) {
    if (child.kind === "folder") sortTree(child);
  }
}
