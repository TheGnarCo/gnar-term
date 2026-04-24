/**
 * Worktree Service — owns the WorktreeWorkspaceEntry list and the
 * archive / merge-archive flows. Persists state to GnarTermConfig.worktrees.
 */
import { get, writable, type Readable } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import {
  getConfig,
  saveConfig,
  type WorktreeWorkspaceEntry,
  type WorktreesSettings,
} from "../config";
import {
  showInputPrompt,
  showFormPrompt,
  showConfirmPrompt,
} from "../stores/ui";
import { eventBus } from "./event-bus";
import {
  resolveRepoPath,
  promptWorktreeConfig,
  createWorktree,
} from "./worktree-helpers";
import { createWorkspaceFromDef, closeWorkspace } from "./workspace-service";
import { workspaces } from "../stores/workspace";

/** Result of a git_merge Tauri command invocation. */
interface MergeResult {
  success: boolean;
  message: string;
  conflicts?: string[];
}

const _entries = writable<WorktreeWorkspaceEntry[]>([]);

// Pre-confirmed worktree actions set by confirmAndCloseWorkspace so that
// handleWorkspaceClosed can skip its own dialog when close was initiated
// through the combined confirm UI.
const pendingCloseActions = new Map<string, "keep" | "delete">();
export const worktreeEntriesStore: Readable<WorktreeWorkspaceEntry[]> =
  _entries;

export function getWorktreeEntries(): WorktreeWorkspaceEntry[] {
  return get(_entries);
}

export function getWorktreeSettings(): WorktreesSettings {
  return getConfig().worktrees?.settings ?? {};
}

/** Hydrate the in-memory store from config — call once at bootstrap. */
export function loadWorktreeEntries(): void {
  const entries = getConfig().worktrees?.entries ?? [];
  _entries.set([...entries]);
}

async function persistEntries(
  entries: WorktreeWorkspaceEntry[],
): Promise<void> {
  _entries.set([...entries]);
  const cfg = getConfig();
  await saveConfig({
    worktrees: {
      ...(cfg.worktrees ?? {}),
      entries,
    },
  });
}

/** Test-only reset. */
export function _resetWorktreeService(): void {
  _entries.set([]);
}

/** Test-only seed — bypasses persistence. */
export function _seedWorktreeEntries(entries: WorktreeWorkspaceEntry[]): void {
  _entries.set([...entries]);
}

interface CreateContext {
  groupPath?: unknown;
  groupId?: unknown;
}

/** Run the full "new worktree workspace" flow. */
export async function createWorktreeWorkspace(
  ctx: CreateContext,
): Promise<void> {
  const repoPath = await resolveRepoPath(ctx.groupPath);
  if (!repoPath) return;

  const settings = getWorktreeSettings();
  const branchPrefix = settings.branchPrefix ?? "";
  const config = await promptWorktreeConfig(repoPath, { branchPrefix });
  if (!config) return;

  await createWorktreeWorkspaceFromConfig({
    repoPath,
    branch: config.branch,
    base: config.base,
    worktreePath: config.worktreePath,
    groupId:
      ctx.groupId !== undefined && ctx.groupId !== null
        ? String(ctx.groupId)
        : undefined,
  });
}

/**
 * Non-interactive worktree-workspace creation. Caller supplies a fully
 * resolved config (branch/base/paths). Used by the agent spawn-helper —
 * which needs to spin up worktree workspaces without going through the
 * showFormPrompt UI flow.
 *
 * Honors the same settings.copyPatterns / settings.setupScript pipeline
 * as the interactive path so behavior is consistent regardless of who
 * created the worktree.
 *
 * Returns the workspace id of the newly-created workspace (read from the
 * workspaces store immediately after createWorkspaceFromDef returns).
 */
export interface WorktreeWorkspaceConfig {
  repoPath: string;
  branch: string;
  base: string;
  worktreePath: string;
  groupId?: string;
  /**
   * Optional startup command to run in the new workspace's terminal.
   * Maps to surface.startupCommand via the WorkspaceDef layout — fires
   * once the PTY is ready (no setTimeout).
   */
  startupCommand?: string;
  /**
   * Dashboard provenance — when the worktree is spawned from the Global
   * Agentic Dashboard or an Agentic Dashboard contribution on a group,
   * this records which. Surfaces as `metadata.spawnedBy` on the new
   * workspace. See spec §5.3.
   */
  spawnedBy?: { kind: "global" } | { kind: "group"; groupId: string };
  /**
   * GitHub issue numbers this workspace is handling. Stamped on the
   * workspace as `metadata.spawnedFromIssues`. Drives the bot-icon /
   * "jump to active workspace" affordance on the Issues widget so users
   * can see at-a-glance which issues already have an agent assigned.
   * Multi-issue spawns ("Spawn Together") write all the issue numbers
   * into a single workspace's array.
   */
  spawnedFromIssues?: number[];
}

export async function createWorktreeWorkspaceFromConfig(
  config: WorktreeWorkspaceConfig,
): Promise<{ workspaceId: string }> {
  const ok = await createWorktree({
    repoPath: config.repoPath,
    branch: config.branch,
    base: config.base,
    worktreePath: config.worktreePath,
  });
  if (!ok) {
    throw new Error(
      `Failed to create worktree at ${config.worktreePath} for branch ${config.branch}`,
    );
  }

  const settings = getWorktreeSettings();
  const copyPatternsStr = settings.copyPatterns ?? "";
  if (copyPatternsStr.trim()) {
    const patterns = copyPatternsStr
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (patterns.length > 0) {
      try {
        await invoke("copy_files", {
          sourceDir: config.repoPath,
          destDir: config.worktreePath,
          patterns,
        });
      } catch {
        // Non-fatal — continue even if copy fails
      }
    }
  }

  const setupScript = settings.setupScript ?? "";
  if (setupScript.trim()) {
    try {
      await invoke("run_script", {
        cwd: config.worktreePath,
        command: setupScript,
      });
    } catch {
      // Non-fatal
    }
  }

  const wsName = `Worktree ${getWorktreeEntries().length + 1}`;
  // Snapshot workspace ids before createWorkspaceFromDef — diff after
  // the call to find the newly-created workspace's id.
  const prevIds = new Set(get(workspaces).map((w) => w.id));

  await createWorkspaceFromDef({
    name: wsName,
    cwd: config.worktreePath,
    env: { GNARTERM_WORKTREE_ROOT: config.repoPath },
    metadata: {
      worktreePath: config.worktreePath,
      branch: config.branch,
      baseBranch: config.base,
      repoPath: config.repoPath,
      ...(config.groupId ? { groupId: config.groupId } : {}),
      ...(config.spawnedBy ? { spawnedBy: config.spawnedBy } : {}),
      ...(config.spawnedFromIssues && config.spawnedFromIssues.length > 0
        ? { spawnedFromIssues: config.spawnedFromIssues }
        : {}),
    },
    layout: {
      pane: {
        surfaces: [
          {
            type: "terminal",
            ...(config.startupCommand
              ? { command: config.startupCommand }
              : {}),
          },
        ],
      },
    },
  });

  // Resolve the new workspace's id (the one not in prevIds).
  let workspaceId = "";
  for (const ws of get(workspaces)) {
    if (!prevIds.has(ws.id)) {
      workspaceId = ws.id;
    }
  }

  const entries = [...getWorktreeEntries()];
  entries.push({
    worktreePath: config.worktreePath,
    branch: config.branch,
    baseBranch: config.base,
    repoPath: config.repoPath,
    createdAt: new Date().toISOString(),
    ...(workspaceId ? { workspaceId } : {}),
  });
  await persistEntries(entries);

  return { workspaceId };
}

/** Archive flow — prompt user, optionally push, then remove worktree. */
export async function archiveWorktreeWorkspace(): Promise<void> {
  const entries = getWorktreeEntries();
  if (entries.length === 0) return;

  const branchNames = entries.map((e) => e.branch).join(", ");
  const selected = await showInputPrompt(
    `Archive which workspace? (${branchNames})`,
  );
  if (!selected) return;

  const entry = entries.find((e) => e.branch === selected.trim());
  if (!entry) return;

  const shouldPush = await showInputPrompt(
    "Push branch before archiving? (yes/no)",
    "yes",
  );

  if (shouldPush?.toLowerCase() === "yes") {
    await invoke("push_branch", {
      repoPath: entry.repoPath,
      branch: entry.branch,
    });
  }

  await invoke("remove_worktree", {
    repoPath: entry.repoPath,
    worktreePath: entry.worktreePath,
  });

  const remaining = entries.filter((e) => e.branch !== selected.trim());
  await persistEntries(remaining);
}

/** Merge & archive flow — checkout base, merge branch, optionally push, remove. */
export async function mergeAndArchiveWorktreeWorkspace(): Promise<void> {
  const entries = getWorktreeEntries();
  if (entries.length === 0) return;

  const branchNames = entries.map((e) => e.branch).join(", ");
  const selected = await showInputPrompt(
    `Merge & archive which worktree? (${branchNames})`,
  );
  if (!selected) return;

  const entry = entries.find((e) => e.branch === selected.trim());
  if (!entry) return;

  const status = await invoke<Array<{ path: string; status: string }>>(
    "git_status",
    { repoPath: entry.worktreePath },
  );
  if (status.length > 0) {
    await showFormPrompt("Cannot merge", [
      {
        key: "error",
        label: "Worktree has uncommitted changes",
        defaultValue: `${status.length} file(s) modified. Commit or stash before merging.`,
      },
    ]);
    return;
  }

  try {
    await invoke("git_checkout", {
      repoPath: entry.repoPath,
      branch: entry.baseBranch,
    });
  } catch (err) {
    await showFormPrompt("Failed to checkout base branch", [
      {
        key: "error",
        label: "Error",
        defaultValue: String(err),
      },
    ]);
    return;
  }

  const result = await invoke<MergeResult>("git_merge", {
    repoPath: entry.repoPath,
    branch: entry.branch,
  });

  if (!result.success) {
    const conflictList = result.conflicts?.join("\n") || "Unknown conflicts";
    await showFormPrompt("Merge failed — conflicts detected", [
      {
        key: "conflicts",
        label: "Conflicting files (merge has been aborted)",
        defaultValue: conflictList,
      },
    ]);
    return;
  }

  const shouldPush = await showInputPrompt(
    "Push merged branch before archiving? (yes/no)",
    "yes",
  );
  if (shouldPush?.toLowerCase() === "yes") {
    try {
      await invoke("push_branch", {
        repoPath: entry.repoPath,
        branch: entry.baseBranch,
      });
    } catch {
      // Non-fatal — push failure doesn't block archive
    }
  }

  try {
    await invoke("remove_worktree", {
      repoPath: entry.repoPath,
      worktreePath: entry.worktreePath,
    });
  } catch {
    // Non-fatal — worktree may already be gone
  }

  eventBus.emit({
    type: "worktree:merged",
    worktreePath: entry.worktreePath,
    branch: entry.branch,
    baseBranch: entry.baseBranch,
    repoPath: entry.repoPath,
    workspaceId: entry.workspaceId || "",
  });

  const remaining = entries.filter((e) => e.branch !== selected.trim());
  await persistEntries(remaining);
}

/**
 * Handle workspace:created — link the workspaceId to a worktree entry whose
 * worktreePath matches the workspace's metadata.
 */
export function handleWorkspaceCreated(
  id: string,
  metadata: Record<string, unknown> | undefined,
): void {
  const worktreePath = metadata?.worktreePath;
  if (typeof worktreePath !== "string") return;
  const entries = [...getWorktreeEntries()];
  const entry = entries.find((e) => e.worktreePath === worktreePath);
  if (!entry) return;
  entry.workspaceId = id;
  void persistEntries(entries);
}

/**
 * Combined close confirmation for worktree workspaces. Shows a single dialog
 * that collects both "confirm close" and "keep/delete worktree" in one step.
 * For non-worktree workspaces falls back to the standard confirm prompt.
 * Calls closeWorkspace(idx) on confirm.
 */
export async function confirmAndCloseWorkspace(
  ws: { id: string; name: string },
  idx: number,
): Promise<boolean> {
  const entry = getWorktreeEntries().find((e) => e.workspaceId === ws.id);
  if (!entry) {
    const confirmed = await showConfirmPrompt(
      `Close "${ws.name}"? This will dispose the terminal.`,
      { title: "Close Workspace", confirmLabel: "Close", danger: true },
    );
    if (!confirmed) return false;
  } else {
    const result = await showFormPrompt(
      `Close "${ws.name}"`,
      [
        {
          key: "path",
          label: "Worktree location",
          type: "info",
          defaultValue: entry.worktreePath,
        },
        {
          key: "action",
          label: "What should happen to the worktree?",
          type: "select",
          defaultValue: "keep",
          options: [
            { label: "Keep worktree on disk", value: "keep" },
            { label: "Delete worktree (git worktree remove)", value: "delete" },
          ],
        },
      ],
      { submitLabel: "Close Workspace" },
    );
    if (!result) return false;
    pendingCloseActions.set(
      ws.id,
      result.action === "delete" ? "delete" : "keep",
    );
  }
  closeWorkspace(idx);
  return true;
}

/**
 * Handle workspace:closed — when a worktree-backed workspace closes, ask
 * the user whether to delete the underlying worktree on disk.
 */
export async function handleWorkspaceClosed(id: string): Promise<void> {
  const entries = getWorktreeEntries();
  const entry = entries.find((e) => e.workspaceId === id);
  if (!entry) return;

  // Use pre-confirmed action when close was initiated via confirmAndCloseWorkspace
  const preAction = pendingCloseActions.get(id);
  pendingCloseActions.delete(id);

  let action: string;
  if (preAction !== undefined) {
    action = preAction;
  } else {
    const result = await showFormPrompt(
      `Worktree for "${entry.branch}"`,
      [
        {
          key: "path",
          label: "Worktree location",
          type: "info",
          defaultValue: entry.worktreePath,
        },
        {
          key: "action",
          label: "What should happen to the worktree?",
          type: "select",
          defaultValue: "keep",
          options: [
            { label: "Keep worktree on disk", value: "keep" },
            {
              label: "Delete worktree (git worktree remove)",
              value: "delete",
            },
          ],
        },
      ],
      { submitLabel: "Apply" },
    );
    action = result?.action ?? "keep";
  }

  const remaining = getWorktreeEntries().filter((e) => e.workspaceId !== id);
  await persistEntries(remaining);

  if (action !== "delete") return;

  try {
    await invoke("remove_worktree", {
      repoPath: entry.repoPath,
      worktreePath: entry.worktreePath,
    });
  } catch (err) {
    console.error(
      `[worktree-service] Failed to remove worktree at ${entry.worktreePath}: ${err}`,
    );
  }
}
