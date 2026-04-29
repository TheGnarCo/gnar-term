/**
 * Git Status Service — polls each workspace's working directory for git
 * branch + dirty count and writes the results into the status registry
 * under source `"git"`.
 *
 * Active workspaces poll fast (5s), inactive ones slow (30s). On `cd`
 * the active workspace's cwd is re-resolved via a debounced `workspaces`
 * store subscription so the sidebar tracks the new directory
 * immediately.
 *
 * PR/CI state was historically registered here under itemId `"pr"`; the
 * pill was retired in favor of the Group Dashboards' `gnar:prs` widget,
 * which renders the full open-PR list with row actions instead of a
 * single per-workspace badge.
 */
import { invoke } from "@tauri-apps/api/core";
import { get } from "svelte/store";
import {
  setStatusItem,
  clearStatusItem,
  clearAllStatusForSourceAndWorkspace,
} from "./status-registry";
import { workspaces, activeWorkspace } from "../stores/workspace";
import { getActiveCwd, getWorkspaceCwd, wsMeta } from "./service-helpers";
import { getWorkspaceGroup } from "../stores/workspace-groups";

export const GIT_STATUS_SOURCE = "git";

export interface GitInfo {
  branch: string;
  isDetached: boolean;
  /** Files whose work-tree state differs from the index (` M` / ` D` / ` T`). */
  modified: number;
  /** Files with changes staged in the index (`M ` / `A ` / `D ` / `R ` / `C ` or doubles like `MM`). */
  staged: number;
  /** Newly added files (either index-A or working-tree-A). */
  added: number;
  /** Deleted files (either column). */
  deleted: number;
  /** Renamed / copied files. */
  renamed: number;
  /** Untracked files (`??`). */
  untracked: number;
  ahead: number;
  behind: number;
}

interface ScriptResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

async function runWithTimeout(
  invocation: Promise<ScriptResult>,
  timeoutMs: number = 10000,
): Promise<string | null> {
  try {
    const result = await Promise.race([
      invocation,
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), timeoutMs),
      ),
    ]);
    if (!result || result.exit_code !== 0) return null;
    return result.stdout;
  } catch {
    return null;
  }
}

export function parseGitStatus(raw: string): GitInfo | null {
  const lines = raw.trim().split("\n");
  if (lines.length === 0) return null;

  const headerLine = lines[0]!;
  const branchMatch = headerLine.match(
    /^## (?:No commits yet on )?(.+?)(?:\.\.\.|$)/,
  );
  if (!branchMatch) return null;

  const branch = branchMatch[1]!;
  const isDetached = headerLine.startsWith("## HEAD (no branch)");
  const aheadMatch = headerLine.match(/\[ahead (\d+)/);
  const behindMatch = headerLine.match(/behind (\d+)/);

  let modified = 0;
  let untracked = 0;
  let staged = 0;
  let added = 0;
  let deleted = 0;
  let renamed = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("??")) {
      untracked++;
      continue;
    }
    const indexStatus = line[0];
    const workTreeStatus = line[1];
    if (indexStatus && indexStatus !== " " && indexStatus !== "?") staged++;
    if (workTreeStatus && workTreeStatus !== " " && workTreeStatus !== "?")
      modified++;
    // Collapse the two-column porcelain code into a per-file dominant
    // operation so the shorthand label doesn't double-count files that
    // have both staged and unstaged changes. Precedence matches git's
    // own summary order (R > C > A > D > M).
    const cols = `${indexStatus ?? ""}${workTreeStatus ?? ""}`;
    if (/[RC]/.test(cols)) renamed++;
    else if (cols.includes("A")) added++;
    else if (cols.includes("D")) deleted++;
    else if (cols.includes("M") || cols.includes("T")) {
      /* already counted in modified/staged; no separate bucket */
    }
  }

  return {
    branch,
    isDetached,
    modified,
    staged,
    added,
    deleted,
    renamed,
    untracked,
    ahead: aheadMatch ? parseInt(aheadMatch[1]!, 10) : 0,
    behind: behindMatch ? parseInt(behindMatch[1]!, 10) : 0,
  };
}

/**
 * Compact git-shorthand label for a dirty working tree. Skips zero
 * buckets; joins non-zero counts with spaces. Example:
 *   M5 A2 D1 ?3  (5 modified, 2 added, 1 deleted, 3 untracked)
 * Empty string when the tree is clean — callers decide whether to
 * render the pill at all.
 */
export function formatDirtyShorthand(info: GitInfo): string {
  // `modified` in the porcelain parse above already covers unstaged
  // edits (including those on files that are ALSO in `staged`). We
  // dedupe against the explicit op buckets so `M` doesn't overlap A/D.
  const modifiedOnly = Math.max(
    0,
    info.modified + info.staged - info.added - info.deleted - info.renamed,
  );
  const parts: string[] = [];
  if (modifiedOnly > 0) parts.push(`M${modifiedOnly}`);
  if (info.added > 0) parts.push(`A${info.added}`);
  if (info.deleted > 0) parts.push(`D${info.deleted}`);
  if (info.renamed > 0) parts.push(`R${info.renamed}`);
  if (info.untracked > 0) parts.push(`?${info.untracked}`);
  return parts.join(" ");
}

function setItem(
  workspaceId: string,
  itemId: string,
  status: Parameters<typeof setStatusItem>[3],
): void {
  setStatusItem(GIT_STATUS_SOURCE, workspaceId, itemId, status);
}

function clearItem(workspaceId: string, itemId: string): void {
  clearStatusItem(GIT_STATUS_SOURCE, workspaceId, itemId);
}

const timers = new Map<string, ReturnType<typeof setInterval>>();
const workspaceCwds = new Map<string, string>();
let activeWorkspaceId: string | null = null;
let homeDir: string | null = null;
let unsubActive: (() => void) | null = null;
let unsubWorkspaces: (() => void) | null = null;
let cwdChangeTimer: ReturnType<typeof setTimeout> | null = null;

async function getHomeDir(): Promise<string | null> {
  if (homeDir) return homeDir;
  try {
    const result = await invoke<string>("get_home");
    homeDir = result?.trim() || null;
  } catch {
    homeDir = null;
  }
  return homeDir;
}

async function detectGitRoot(cwd: string): Promise<string | null> {
  const result = await runWithTimeout(
    invoke<ScriptResult>("git_rev_parse_toplevel", { cwd }),
    5000,
  );
  const root = result?.trim() || null;
  if (!root) return null;

  const home = await getHomeDir();
  if (home && root === home) return null;

  return root;
}

function prettyCwd(cwd: string): string {
  return cwd.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
}

async function refreshGitStatus(
  workspaceId: string,
  cwd: string,
): Promise<string | null> {
  setItem(workspaceId, "cwd", {
    category: "info",
    priority: 5,
    label: prettyCwd(cwd),
    variant: "muted",
  });

  const gitRoot = await detectGitRoot(cwd);

  if (!gitRoot) {
    clearItem(workspaceId, "branch");
    clearItem(workspaceId, "dirty");
    return null;
  }

  const raw = await runWithTimeout(
    invoke<ScriptResult>("git_status_short", { cwd: gitRoot }),
    5000,
  );
  if (!raw) {
    clearItem(workspaceId, "branch");
    clearItem(workspaceId, "dirty");
    return null;
  }

  const info = parseGitStatus(raw);
  if (!info) {
    clearItem(workspaceId, "branch");
    clearItem(workspaceId, "dirty");
    return null;
  }

  let branchLabel = info.branch;
  if (info.ahead > 0 || info.behind > 0) {
    const parts: string[] = [];
    if (info.ahead > 0) parts.push(`+${info.ahead}`);
    if (info.behind > 0) parts.push(`-${info.behind}`);
    branchLabel += ` ${parts.join(" ")}`;
  }
  setItem(workspaceId, "branch", {
    category: "git",
    priority: 10,
    label: branchLabel,
    variant: "default",
    metadata: {
      repoRoot: gitRoot,
      isDetached: info.isDetached,
    },
  });

  const shorthand = formatDirtyShorthand(info);
  if (shorthand.length > 0) {
    setItem(workspaceId, "dirty", {
      category: "git",
      priority: 30,
      label: shorthand,
      // Tooltip expands the shorthand in plain English so users who
      // haven't memorized porcelain codes can still read the summary.
      tooltip: dirtyTooltip(info),
      variant: "warning",
      action: {
        // Per-workspace pill: open the diff viewer in the currently-
        // active pane of the workspace the pill belongs to. The
        // container-row pill (see PathStatusLine) routes through
        // `open-surface-in-new-workspace` instead because a container
        // has no single "current pane" to drop a surface into.
        command: "open-surface",
        args: [
          "diff-viewer:diff",
          "Uncommitted Changes",
          { repoPath: gitRoot },
        ],
      },
      metadata: {
        modified: info.modified,
        added: info.added,
        deleted: info.deleted,
        renamed: info.renamed,
        untracked: info.untracked,
        staged: info.staged,
      },
    });
  } else {
    clearItem(workspaceId, "dirty");
  }
  return gitRoot;
}

function dirtyTooltip(info: GitInfo): string {
  const parts: string[] = [];
  if (info.modified > 0) parts.push(`${info.modified} modified`);
  if (info.added > 0) parts.push(`${info.added} added`);
  if (info.deleted > 0) parts.push(`${info.deleted} deleted`);
  if (info.renamed > 0) parts.push(`${info.renamed} renamed`);
  if (info.untracked > 0) parts.push(`${info.untracked} untracked`);
  return parts.join(", ");
}

function startPolling(workspaceId: string, cwd: string): void {
  stopPolling(workspaceId);
  workspaceCwds.set(workspaceId, cwd);

  const isActive = workspaceId === activeWorkspaceId;
  // Faster cadence (5s / 30s) so the dirty shorthand tracks edits
  // closely. `.git/index` file-watching backs this up for sub-second
  // reactivity on actual git ops — the timer is the fallback for
  // non-git edits (file-system changes from the user's editor, etc.)
  // and for environments where the watcher can't attach.
  const gitInterval = isActive ? 5_000 : 30_000;

  void refreshGitStatus(workspaceId, cwd).then((root) =>
    attachIndexWatcher(workspaceId, cwd, root),
  );

  const gitTimer = setInterval(() => {
    const latest = workspaceCwds.get(workspaceId);
    if (latest) void refreshGitStatus(workspaceId, latest);
  }, gitInterval);

  timers.set(`${workspaceId}:git`, gitTimer);
}

/**
 * Watch a workspace's `.git/index` via the shared Tauri file watcher.
 * Any git operation (stage, commit, checkout) rewrites this file, so
 * a single watch notification is a reliable "status may have changed"
 * signal. Debounced to coalesce burst writes (e.g. `git add` of many
 * files). Failures fall back to the polling timer.
 */
const indexWatches = new Map<string, number>();
const indexUnlistens = new Map<string, () => void>();
const refreshDebounce = new Map<string, ReturnType<typeof setTimeout>>();
async function attachIndexWatcher(
  workspaceId: string,
  cwd: string,
  gitRoot: string | null,
): Promise<void> {
  try {
    if (!gitRoot) return;
    const indexPath = `${gitRoot}/.git/index`;
    const existing = indexWatches.get(workspaceId);
    if (existing !== undefined) {
      try {
        await invoke("unwatch_file", { watchId: existing });
      } catch {
        /* ignore */
      }
      indexWatches.delete(workspaceId);
    }
    const watchId = await invoke<number>("watch_file", { path: indexPath });
    indexWatches.set(workspaceId, watchId);
    // The watcher delivers its payload via a Tauri event. We listen on
    // "file_changed" with the matching watchId — see terminal-service
    // for the pattern. Debounce so a burst of writes (git add .) only
    // fires one refresh.
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<{ watchId: number }>(
      "file_changed",
      (event) => {
        if (event.payload?.watchId !== watchId) return;
        const pending = refreshDebounce.get(workspaceId);
        if (pending) clearTimeout(pending);
        refreshDebounce.set(
          workspaceId,
          setTimeout(() => {
            refreshDebounce.delete(workspaceId);
            const latest = workspaceCwds.get(workspaceId);
            if (latest) void refreshGitStatus(workspaceId, latest);
          }, 150),
        );
      },
    );
    indexUnlistens.set(workspaceId, unlisten);
  } catch {
    // Best-effort — the polling timer is still in place.
  }
}

async function detachIndexWatcher(workspaceId: string): Promise<void> {
  const watchId = indexWatches.get(workspaceId);
  if (watchId === undefined) return;
  indexWatches.delete(workspaceId);
  const unlisten = indexUnlistens.get(workspaceId);
  if (unlisten) {
    unlisten();
    indexUnlistens.delete(workspaceId);
  }
  const pending = refreshDebounce.get(workspaceId);
  if (pending) clearTimeout(pending);
  refreshDebounce.delete(workspaceId);
  try {
    await invoke("unwatch_file", { watchId });
  } catch {
    /* ignore */
  }
}

function stopPolling(workspaceId: string): void {
  const gitTimer = timers.get(`${workspaceId}:git`);
  if (gitTimer) clearInterval(gitTimer);
  timers.delete(`${workspaceId}:git`);
  void detachIndexWatcher(workspaceId);
}

function stopAllPolling(): void {
  for (const timer of timers.values()) {
    clearInterval(timer);
  }
  timers.clear();
  workspaceCwds.clear();
}

async function ensurePolling(wsId: string): Promise<void> {
  if (workspaceCwds.has(wsId)) return;

  // Active workspace can use the cheaper live-surface lookup; other
  // workspaces walk their own split tree so newly-created-but-inactive
  // rows don't wait for the user to activate them before status fills.
  let cwd =
    activeWorkspaceId === wsId
      ? await getActiveCwd()
      : await getWorkspaceCwd(wsId);

  if (!cwd) {
    // Nested workspaces that haven't been activated yet have no pty CWD.
    // Fall back to the group's root path so their diff status still
    // shows the project's dirty state until they're first opened.
    const ws = get(workspaces).find((w) => w.id === wsId);
    if (ws) {
      const groupId = wsMeta(ws).groupId;
      if (typeof groupId === "string") {
        cwd = getWorkspaceGroup(groupId)?.path;
      }
    }
  }

  if (!cwd) return;
  if (workspaceCwds.has(wsId)) return;
  startPolling(wsId, cwd);
}

export function startGitStatusService(): void {
  unsubActive = activeWorkspace.subscribe((ws) => {
    activeWorkspaceId = ws?.id || null;
    if (activeWorkspaceId) {
      void ensurePolling(activeWorkspaceId);
    }
  });

  // Bootstrap: kick polling for every workspace already in the store —
  // restored sessions don't fire `workspace:created`, so without this
  // pass only the active workspace would populate status on startup.
  for (const ws of get(workspaces)) {
    void ensurePolling(ws.id);
  }

  unsubWorkspaces = workspaces.subscribe((wsList) => {
    // Kick off polling for any workspace whose pty CWD just became available
    // (covers the case where the pty starts after the service was initialised).
    for (const ws of wsList) {
      if (!workspaceCwds.has(ws.id)) {
        void ensurePolling(ws.id);
      }
    }

    if (!activeWorkspaceId) return;
    const cached = workspaceCwds.get(activeWorkspaceId);
    if (!cached) return;
    if (cwdChangeTimer) clearTimeout(cwdChangeTimer);
    const wsId = activeWorkspaceId;
    cwdChangeTimer = setTimeout(() => {
      if (activeWorkspaceId !== wsId) return;
      void (async () => {
        const live = await getActiveCwd();
        if (!live || activeWorkspaceId !== wsId) return;
        if (live === workspaceCwds.get(wsId)) return;
        workspaceCwds.set(wsId, live);
        void refreshGitStatus(wsId, live);
      })();
    }, 500);
  });
}

export function handleWorkspaceActivated(wsId: string): void {
  activeWorkspaceId = wsId;
  const cachedCwd = workspaceCwds.get(wsId);
  if (cachedCwd) {
    void refreshGitStatus(wsId, cachedCwd);
  } else {
    void ensurePolling(wsId);
  }
}

export function handleWorkspaceCreated(wsId: string): void {
  if (!wsId) return;
  void ensurePolling(wsId);
}

export function handleWorkspaceClosed(wsId: string): void {
  if (!wsId) return;
  stopPolling(wsId);
  clearAllStatusForSourceAndWorkspace(GIT_STATUS_SOURCE, wsId);
  workspaceCwds.delete(wsId);
}

/** Test-only reset. */
export function _resetGitStatusService(): void {
  stopAllPolling();
  if (cwdChangeTimer) clearTimeout(cwdChangeTimer);
  cwdChangeTimer = null;
  unsubActive?.();
  unsubWorkspaces?.();
  unsubActive = null;
  unsubWorkspaces = null;
  activeWorkspaceId = null;
  homeDir = null;
}

/** Test-only — read internal state without exporting cache primitives broadly. */
export function _getActiveWorkspaceId(): string | null {
  return activeWorkspaceId;
}

export function _getCachedCwd(wsId: string): string | undefined {
  return workspaceCwds.get(wsId);
}
