/**
 * Git Status Service — polls each workspace's working directory for git
 * branch, dirty count, and PR/CI state and writes the results into the
 * status registry under source `"git"`.
 *
 * Active workspaces poll fast (30s git / 60s PR), inactive ones slow
 * (150s / 300s). On `cd` the active workspace's cwd is re-resolved via
 * a debounced `workspaces` store subscription so the sidebar tracks the
 * new directory immediately.
 */
import { invoke } from "@tauri-apps/api/core";
import { get } from "svelte/store";
import {
  setStatusItem,
  clearStatusItem,
  clearAllStatusForSourceAndWorkspace,
} from "./status-registry";
import { workspaces, activeWorkspace } from "../stores/workspace";
import { getActiveCwd, getWorkspaceCwd } from "./service-helpers";

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

export interface PrInfo {
  number: number;
  url: string;
  reviewDecision: string;
  ciStatus: "passing" | "failing" | "pending" | "none";
}

interface ScriptResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

async function runWithTimeout(
  cwd: string,
  command: string,
  timeoutMs: number = 10000,
): Promise<string | null> {
  try {
    const result = await Promise.race([
      invoke<ScriptResult>("run_script", { cwd, command }),
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

export function parsePrInfo(raw: string): PrInfo | null {
  try {
    const data = JSON.parse(raw);
    if (!data.number) return null;

    let ciStatus: PrInfo["ciStatus"] = "none";
    const checks = data.statusCheckRollup;
    if (Array.isArray(checks) && checks.length > 0) {
      const hasFailure = checks.some(
        (c: { state?: string; conclusion?: string }) =>
          c.state === "FAILURE" ||
          c.conclusion === "FAILURE" ||
          c.state === "ERROR" ||
          c.conclusion === "ERROR",
      );
      const hasPending = checks.some(
        (c: { state?: string; conclusion?: string }) =>
          c.state === "PENDING" || !c.conclusion,
      );
      if (hasFailure) ciStatus = "failing";
      else if (hasPending) ciStatus = "pending";
      else ciStatus = "passing";
    }

    let reviewDecision = "none";
    if (data.reviewDecision === "APPROVED") reviewDecision = "approved";
    else if (data.reviewDecision === "CHANGES_REQUESTED")
      reviewDecision = "changes requested";
    else if (data.reviewDecision === "REVIEW_REQUIRED")
      reviewDecision = "review requested";

    return {
      number: data.number,
      url: data.url,
      reviewDecision,
      ciStatus,
    };
  } catch {
    return null;
  }
}

function reviewVariant(
  decision: string,
): "success" | "warning" | "error" | "muted" {
  switch (decision) {
    case "approved":
      return "success";
    case "review requested":
      return "warning";
    case "changes requested":
      return "error";
    default:
      return "muted";
  }
}

function ciVariant(
  status: PrInfo["ciStatus"],
): "success" | "warning" | "error" | "muted" {
  switch (status) {
    case "passing":
      return "success";
    case "pending":
      return "warning";
    case "failing":
      return "error";
    default:
      return "muted";
  }
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
const prCache = new Map<string, { branch: string; pr: PrInfo | null }>();
const workspaceCwds = new Map<string, string>();
const prDisplayed = new Set<string>();
let activeWorkspaceId: string | null = null;
let homeDir: string | null = null;
let unsubActive: (() => void) | null = null;
let unsubWorkspaces: (() => void) | null = null;
let cwdChangeTimer: ReturnType<typeof setTimeout> | null = null;

async function getHomeDir(): Promise<string | null> {
  if (homeDir) return homeDir;
  const result = await runWithTimeout("/tmp", "echo $HOME", 2000);
  homeDir = result?.trim() || null;
  return homeDir;
}

async function detectGitRoot(cwd: string): Promise<string | null> {
  const result = await runWithTimeout(
    cwd,
    "git rev-parse --show-toplevel",
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
): Promise<void> {
  setItem(workspaceId, "cwd", {
    category: "info",
    priority: 5,
    label: prettyCwd(cwd),
    variant: "muted",
  });

  const gitRoot = await detectGitRoot(cwd);

  if (!gitRoot) {
    clearItem(workspaceId, "branch");
    clearItem(workspaceId, "pr");
    clearItem(workspaceId, "dirty");
    prDisplayed.delete(workspaceId);
    return;
  }

  const raw = await runWithTimeout(
    gitRoot,
    "git status --porcelain=v1 -b",
    5000,
  );
  if (!raw) {
    clearItem(workspaceId, "branch");
    clearItem(workspaceId, "dirty");
    return;
  }

  const info = parseGitStatus(raw);
  if (!info) {
    clearItem(workspaceId, "branch");
    clearItem(workspaceId, "dirty");
    return;
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

function registerPrItem(workspaceId: string, pr: PrInfo): void {
  setItem(workspaceId, "pr", {
    category: "git",
    priority: 20,
    label: `#${pr.number}`,
    tooltip: `${pr.reviewDecision} · CI ${pr.ciStatus}`,
    variant: ciVariant(pr.ciStatus),
    action: { command: "open-url", args: [pr.url] },
    metadata: {
      prNumber: pr.number,
      prUrl: pr.url,
      ciStatus: pr.ciStatus,
      reviewState: pr.reviewDecision,
      reviewVariant: reviewVariant(pr.reviewDecision),
    },
  });
}

async function refreshPrStatus(
  workspaceId: string,
  cwd: string,
): Promise<void> {
  const gitRoot = await detectGitRoot(cwd);
  if (!gitRoot) return;

  const branchRaw = await runWithTimeout(
    gitRoot,
    "git rev-parse --abbrev-ref HEAD",
    3000,
  );
  const branch = branchRaw?.trim();
  if (!branch || branch === "HEAD") {
    clearItem(workspaceId, "pr");
    return;
  }

  const cached = prCache.get(workspaceId);
  if (cached && cached.branch === branch && cached.pr) {
    registerPrItem(workspaceId, cached.pr);
    return;
  }

  if (!prDisplayed.has(workspaceId)) {
    setItem(workspaceId, "pr", {
      category: "git",
      priority: 20,
      label: "PR…",
      tooltip: "Checking GitHub for pull request",
      variant: "muted",
    });
    prDisplayed.add(workspaceId);
  }

  const raw = await runWithTimeout(
    gitRoot,
    `gh pr view --json number,url,reviewDecision,statusCheckRollup -- "${branch.replace(/"/g, '\\"')}"`,
    10000,
  );

  if (!raw) {
    clearItem(workspaceId, "pr");
    prDisplayed.delete(workspaceId);
    prCache.set(workspaceId, { branch, pr: null });
    return;
  }

  const pr = parsePrInfo(raw);
  prCache.set(workspaceId, { branch, pr });

  if (pr) {
    registerPrItem(workspaceId, pr);
    prDisplayed.add(workspaceId);
  } else {
    clearItem(workspaceId, "pr");
    prDisplayed.delete(workspaceId);
  }
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
  const prInterval = isActive ? 60_000 : 300_000;

  void refreshGitStatus(workspaceId, cwd);
  void refreshPrStatus(workspaceId, cwd);
  void attachIndexWatcher(workspaceId, cwd);

  const gitTimer = setInterval(() => {
    const latest = workspaceCwds.get(workspaceId);
    if (latest) void refreshGitStatus(workspaceId, latest);
  }, gitInterval);
  const prTimer = setInterval(() => {
    const latest = workspaceCwds.get(workspaceId);
    if (latest) void refreshPrStatus(workspaceId, latest);
  }, prInterval);

  timers.set(`${workspaceId}:git`, gitTimer);
  timers.set(`${workspaceId}:pr`, prTimer);
}

/**
 * Watch a workspace's `.git/index` via the shared Tauri file watcher.
 * Any git operation (stage, commit, checkout) rewrites this file, so
 * a single watch notification is a reliable "status may have changed"
 * signal. Debounced to coalesce burst writes (e.g. `git add` of many
 * files). Failures fall back to the polling timer.
 */
const indexWatches = new Map<string, number>();
const refreshDebounce = new Map<string, ReturnType<typeof setTimeout>>();
async function attachIndexWatcher(
  workspaceId: string,
  cwd: string,
): Promise<void> {
  try {
    const gitRoot = await detectGitRoot(cwd);
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
    await listen<{ watchId: number }>("file_changed", (event) => {
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
    });
  } catch {
    // Best-effort — the polling timer is still in place.
  }
}

async function detachIndexWatcher(workspaceId: string): Promise<void> {
  const watchId = indexWatches.get(workspaceId);
  if (watchId === undefined) return;
  indexWatches.delete(workspaceId);
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
  const prTimer = timers.get(`${workspaceId}:pr`);
  if (gitTimer) clearInterval(gitTimer);
  if (prTimer) clearInterval(prTimer);
  timers.delete(`${workspaceId}:git`);
  timers.delete(`${workspaceId}:pr`);
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
  const cwd =
    activeWorkspaceId === wsId
      ? await getActiveCwd()
      : await getWorkspaceCwd(wsId);
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

  unsubWorkspaces = workspaces.subscribe(() => {
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
        void refreshPrStatus(wsId, live);
      })();
    }, 500);
  });
}

export function handleWorkspaceActivated(wsId: string): void {
  activeWorkspaceId = wsId;
  const cachedCwd = workspaceCwds.get(wsId);
  if (cachedCwd) {
    void refreshGitStatus(wsId, cachedCwd);
    void refreshPrStatus(wsId, cachedCwd);
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
  prCache.delete(wsId);
  workspaceCwds.delete(wsId);
  prDisplayed.delete(wsId);
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
  prCache.clear();
  prDisplayed.clear();
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
