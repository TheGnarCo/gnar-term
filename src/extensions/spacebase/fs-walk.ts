/**
 * Recursive markdown file walker.
 *
 * Used by SpacebaseWorkspaceDashboard to find local `.md` files under the
 * workspace's `syncDir` so they can be matched against remote spacebase
 * docs. The list dependency is injected (matches Tauri `mcp_list_dir`'s
 * shape) so the walker is testable without filesystem access.
 */

export type DirEntry = {
  name: string;
  path: string;
  is_dir: boolean;
};

export type ListDir = (path: string) => Promise<DirEntry[]>;

export async function walkMarkdownFiles(
  rootDir: string,
  listDir: ListDir,
): Promise<string[]> {
  const out: string[] = [];
  await walk(rootDir, "", listDir, out);
  return out;
}

async function walk(
  absDir: string,
  relPrefix: string,
  listDir: ListDir,
  out: string[],
): Promise<void> {
  let entries: DirEntry[];
  try {
    entries = await listDir(absDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const rel = relPrefix === "" ? entry.name : `${relPrefix}/${entry.name}`;
    if (entry.is_dir) {
      await walk(entry.path, rel, listDir, out);
    } else if (entry.name.toLowerCase().endsWith(".md")) {
      out.push(rel);
    }
  }
}
