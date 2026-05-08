/**
 * Workspace-dashboard data layer — pure functions, no Svelte / no fetch.
 *
 * Mirrors the file convention from
 * `~/.claude/plugins/marketplaces/gnar/spacebase/skills/spacebase-api/scripts/spacebase-sync.sh`
 * so the per-workspace dashboard surfaces the same files the user pushes
 * with the gnar plugin's `/sync` command.
 */
import { sanitize } from "./sanitize";
import type { DocSummary } from "./api-client";

/**
 * Compute the local relative path for a remote doc. Convention:
 * - sanitized = sanitize(title)
 * - folder_path is "/" or empty → "{sanitized}.md"
 * - else → "{folder_path stripped of leading/trailing slashes}/{sanitized}.md"
 */
export function expectedRelPathFor(doc: DocSummary): string {
  const sanitized = sanitize(doc.title);
  const folder = (doc.folder_path ?? "").replace(/^\/+|\/+$/g, "");
  return folder === "" ? `${sanitized}.md` : `${folder}/${sanitized}.md`;
}

export type FileStatus = "synced" | "locked" | "local-only" | "remote-only";

export type DashboardEntry = {
  status: FileStatus;
  relPath: string;
  title: string;
  doc: DocSummary | null;
};

export function computeDashboardEntries(
  localRelPaths: string[],
  remoteDocs: DocSummary[],
): DashboardEntry[] {
  const localSet = new Set(localRelPaths);
  const matched = new Set<string>();
  const entries: DashboardEntry[] = [];

  for (const doc of remoteDocs) {
    const rel = expectedRelPathFor(doc);
    if (localSet.has(rel)) {
      matched.add(rel);
      entries.push({
        status: doc.locked ? "locked" : "synced",
        relPath: rel,
        title: doc.title,
        doc,
      });
    } else {
      entries.push({
        status: "remote-only",
        relPath: rel,
        title: doc.title,
        doc,
      });
    }
  }

  for (const rel of localRelPaths) {
    if (matched.has(rel)) continue;
    entries.push({
      status: "local-only",
      relPath: rel,
      title: titleFromRelPath(rel),
      doc: null,
    });
  }

  return entries.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

function titleFromRelPath(rel: string): string {
  const last = rel.split("/").pop() ?? rel;
  return last.replace(/\.md$/, "");
}
