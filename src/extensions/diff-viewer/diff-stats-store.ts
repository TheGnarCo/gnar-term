/**
 * Diff Stats Store — module-level store mapping workspace IDs to their
 * uncommitted line counts (+additions / -deletions). Updated by the
 * diff-viewer extension's polling service on workspace:activated events.
 */
import { writable, get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { workspaces } from "../../lib/stores/workspace";
import { getWorkspaceGroup } from "../../lib/stores/workspace-groups";
import { parseDiff } from "./diff-parser";

export interface DiffStats {
  added: number;
  deleted: number;
}

export const diffStatsStore = writable<Record<string, DiffStats>>({});

function getGitPathForWorkspace(workspaceId: string): string | null {
  const ws = get(workspaces).find((w) => w.id === workspaceId);
  if (!ws) return null;
  const md = (ws.metadata ?? {}) as Record<string, unknown>;
  const worktreePath = md.worktreePath;
  if (typeof worktreePath === "string") return worktreePath;
  const groupId = md.groupId;
  if (typeof groupId !== "string") return null;
  const group = getWorkspaceGroup(groupId);
  return group?.isGit ? group.path : null;
}

function countDiffStats(rawDiff: string): DiffStats {
  const files = parseDiff(rawDiff);
  let added = 0;
  let deleted = 0;
  for (const file of files) {
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type === "add") added++;
        else if (line.type === "delete") deleted++;
      }
    }
  }
  return { added, deleted };
}

export async function updateDiffStatsForWorkspace(
  workspaceId: string,
): Promise<void> {
  const repoPath = getGitPathForWorkspace(workspaceId);
  if (!repoPath) return;
  try {
    const rawDiff = await invoke<string>("git_diff", {
      repoPath,
      base: "HEAD",
    });
    const stats = countDiffStats(rawDiff);
    diffStatsStore.update((current) => ({ ...current, [workspaceId]: stats }));
  } catch {
    // Non-git path or git error — silently skip
  }
}

export function clearDiffStats(): void {
  diffStatsStore.set({});
}
