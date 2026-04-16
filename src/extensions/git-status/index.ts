/**
 * Git Status — included extension
 *
 * Sources git branch, dirty state, PR review status, and CI check status
 * from the workspace's working directory. Registers status items into the
 * workspace status registry for sidebar display.
 */
import type { ExtensionManifest, ExtensionAPI } from "../api";
import GitStatusLine from "./GitStatusLine.svelte";

export const gitStatusManifest: ExtensionManifest = {
  id: "git-status",
  name: "Git Status",
  version: "0.1.0",
  description: "Shows git branch, PR, and dirty status in the sidebar",
  entry: "./index.ts",
  included: true,
  permissions: ["shell"],
  contributes: {
    events: [
      "workspace:created",
      "workspace:activated",
      "workspace:closed",
      "surface:titleChanged",
    ],
  },
};

// --- Types ---

interface GitInfo {
  branch: string;
  isDetached: boolean;
  modified: number;
  untracked: number;
  staged: number;
  ahead: number;
  behind: number;
}

interface PrInfo {
  number: number;
  url: string;
  reviewDecision: string;
  ciStatus: "passing" | "failing" | "pending" | "none";
}

// --- Helpers ---

/** Run a shell command with a timeout. Returns stdout or null on failure. */
async function runWithTimeout(
  api: ExtensionAPI,
  cwd: string,
  command: string,
  timeoutMs: number = 10000,
): Promise<string | null> {
  try {
    const result = await Promise.race([
      api.invoke("run_script", { cwd, command }) as Promise<{
        stdout: string;
        stderr: string;
        exit_code: number;
      }>,
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

function parseGitStatus(raw: string): GitInfo | null {
  const lines = raw.trim().split("\n");
  if (lines.length === 0) return null;

  const headerLine = lines[0]!;
  // Header: ## branch...tracking [ahead N, behind M]
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

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("??")) {
      untracked++;
    } else {
      const indexStatus = line[0];
      const workTreeStatus = line[1];
      if (indexStatus && indexStatus !== " " && indexStatus !== "?") staged++;
      if (workTreeStatus && workTreeStatus !== " " && workTreeStatus !== "?")
        modified++;
    }
  }

  return {
    branch,
    isDetached,
    modified,
    untracked,
    staged,
    ahead: aheadMatch ? parseInt(aheadMatch[1]!, 10) : 0,
    behind: behindMatch ? parseInt(behindMatch[1]!, 10) : 0,
  };
}

function parsePrInfo(raw: string): PrInfo | null {
  try {
    const data = JSON.parse(raw);
    if (!data.number) return null;

    // Determine CI status from statusCheckRollup
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

    // Map review decision
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

// --- Extension ---

export function registerGitStatusExtension(api: ExtensionAPI): void {
  const timers = new Map<string, ReturnType<typeof setInterval>>();
  const prCache = new Map<string, { branch: string; pr: PrInfo | null }>();
  const workspaceCwds = new Map<string, string>(); // per-workspace CWD cache
  let activeWorkspaceId: string | null = null;

  let homeDir: string | null = null;

  async function getHomeDir(): Promise<string | null> {
    if (homeDir) return homeDir;
    const result = await runWithTimeout(api, "/tmp", "echo $HOME", 2000);
    homeDir = result?.trim() || null;
    return homeDir;
  }

  async function detectGitRoot(
    api: ExtensionAPI,
    cwd: string,
  ): Promise<string | null> {
    const result = await runWithTimeout(
      api,
      cwd,
      "git rev-parse --show-toplevel",
      5000,
    );
    const root = result?.trim() || null;
    if (!root) return null;

    // Skip home directory — it's typically a dotfiles repo, not a project
    const home = await getHomeDir();
    if (home && root === home) return null;

    return root;
  }

  async function refreshGitStatus(
    workspaceId: string,
    cwd: string,
  ): Promise<void> {
    const gitRoot = await detectGitRoot(api, cwd);

    if (!gitRoot) {
      // Not a git repo — show CWD
      api.setStatus(workspaceId, "cwd", {
        category: "info",
        priority: 10,
        label: cwd.replace(/^\/Users\/[^/]+/, "~"),
        variant: "muted",
      });
      api.clearStatus(workspaceId, "branch");
      api.clearStatus(workspaceId, "pr");
      api.clearStatus(workspaceId, "dirty");
      return;
    }

    // Git repo detected — get branch + dirty
    api.clearStatus(workspaceId, "cwd");
    const raw = await runWithTimeout(
      api,
      gitRoot,
      "git status --porcelain=v1 -b",
      5000,
    );
    if (!raw) {
      // Command failed (timeout, git error, repo vanished). Clear any
      // previous branch/dirty items instead of leaving stale data on screen.
      api.clearStatus(workspaceId, "branch");
      api.clearStatus(workspaceId, "dirty");
      return;
    }

    const info = parseGitStatus(raw);
    if (!info) {
      api.clearStatus(workspaceId, "branch");
      api.clearStatus(workspaceId, "dirty");
      return;
    }

    // Branch item
    let branchLabel = info.branch;
    if (info.ahead > 0 || info.behind > 0) {
      const parts: string[] = [];
      if (info.ahead > 0) parts.push(`+${info.ahead}`);
      if (info.behind > 0) parts.push(`-${info.behind}`);
      branchLabel += ` ${parts.join(" ")}`;
    }
    api.setStatus(workspaceId, "branch", {
      category: "git",
      priority: 10,
      label: branchLabel,
      variant: "default",
      metadata: {
        repoRoot: gitRoot,
        isDetached: info.isDetached,
      },
    });

    // Dirty item — click opens diff surface
    const totalDirty = info.modified + info.untracked + info.staged;
    if (totalDirty > 0) {
      api.setStatus(workspaceId, "dirty", {
        category: "git",
        priority: 30,
        label: `${totalDirty} modified`,
        variant: "warning",
        action: {
          command: "open-surface",
          args: [
            "diff-viewer:diff",
            "Uncommitted Changes",
            { repoPath: gitRoot },
          ],
        },
        metadata: {
          modified: info.modified,
          untracked: info.untracked,
          staged: info.staged,
        },
      });
    } else {
      api.clearStatus(workspaceId, "dirty");
    }
  }

  async function refreshPrStatus(
    workspaceId: string,
    cwd: string,
  ): Promise<void> {
    const gitRoot = await detectGitRoot(api, cwd);
    if (!gitRoot) return;

    // Get current branch
    const branchRaw = await runWithTimeout(
      api,
      gitRoot,
      "git rev-parse --abbrev-ref HEAD",
      3000,
    );
    const branch = branchRaw?.trim();
    if (!branch || branch === "HEAD") {
      api.clearStatus(workspaceId, "pr");
      return;
    }

    // Check cache — skip if branch hasn't changed
    const cached = prCache.get(workspaceId);
    if (cached && cached.branch === branch && cached.pr) {
      // Re-register from cache (in case it was cleared)
      registerPrItem(workspaceId, cached.pr);
      return;
    }

    // Query gh for PR info — use -- to prevent branch name injection
    const raw = await runWithTimeout(
      api,
      gitRoot,
      `gh pr view --json number,url,reviewDecision,statusCheckRollup -- "${branch.replace(/"/g, '\\"')}"`,
      10000,
    );

    if (!raw) {
      api.clearStatus(workspaceId, "pr");
      prCache.set(workspaceId, { branch, pr: null });
      return;
    }

    const pr = parsePrInfo(raw);
    prCache.set(workspaceId, { branch, pr });

    if (pr) {
      registerPrItem(workspaceId, pr);
    } else {
      api.clearStatus(workspaceId, "pr");
    }
  }

  function registerPrItem(workspaceId: string, pr: PrInfo): void {
    api.setStatus(workspaceId, "pr", {
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

  function startPolling(workspaceId: string, cwd: string): void {
    stopPolling(workspaceId);
    workspaceCwds.set(workspaceId, cwd);

    const isActive = workspaceId === activeWorkspaceId;
    const gitInterval = isActive ? 30_000 : 150_000;
    const prInterval = isActive ? 60_000 : 300_000;

    // Initial refresh
    void refreshGitStatus(workspaceId, cwd);
    void refreshPrStatus(workspaceId, cwd);

    // Set up polling — CWD captured in closure, scoped to this workspace
    const gitTimer = setInterval(
      () => void refreshGitStatus(workspaceId, cwd),
      gitInterval,
    );
    const prTimer = setInterval(
      () => void refreshPrStatus(workspaceId, cwd),
      prInterval,
    );

    timers.set(`${workspaceId}:git`, gitTimer);
    timers.set(`${workspaceId}:pr`, prTimer);
  }

  function stopPolling(workspaceId: string): void {
    const gitTimer = timers.get(`${workspaceId}:git`);
    const prTimer = timers.get(`${workspaceId}:pr`);
    if (gitTimer) clearInterval(gitTimer);
    if (prTimer) clearInterval(prTimer);
    timers.delete(`${workspaceId}:git`);
    timers.delete(`${workspaceId}:pr`);
  }

  function stopAllPolling(): void {
    for (const timer of timers.values()) {
      clearInterval(timer);
    }
    timers.clear();
    workspaceCwds.clear();
  }

  // Cleanup handles — declared in register scope so onDeactivate can capture them
  let unsubActive: (() => void) | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // onDeactivate must be called synchronously during register(), not inside onActivate
  api.onDeactivate(() => {
    stopAllPolling();
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
    unsubActive?.();
  });

  api.onActivate(() => {
    // Register subtitle component for workspace status display
    api.registerWorkspaceSubtitle(GitStatusLine, 10);

    // Helper: ensure the given workspace has a CWD cached and is polling.
    // Only pulls from getActiveCwd when wsId is the currently-active workspace
    // (preventing race conditions where async resolution assigns the wrong CWD).
    async function ensurePolling(wsId: string): Promise<void> {
      if (workspaceCwds.has(wsId)) return; // already polling with cached CWD

      // Capture activeWorkspaceId at call time — if it changes during the
      // async getActiveCwd, we discard the result to avoid cross-contamination.
      const expectedActive = activeWorkspaceId;
      if (expectedActive !== wsId) return; // not the active workspace

      const cwd = await api.getActiveCwd();
      if (!cwd) return;
      if (activeWorkspaceId !== expectedActive) return; // user switched
      if (workspaceCwds.has(wsId)) return; // another path beat us
      startPolling(wsId, cwd);
    }

    // Track active workspace — source of truth for "which workspace is active"
    unsubActive = api.activeWorkspace.subscribe((ws) => {
      activeWorkspaceId = ws?.id || null;
      if (activeWorkspaceId) {
        void ensurePolling(activeWorkspaceId);
      }
    });

    api.on("workspace:activated", (event) => {
      const wsId = event.id as string;
      activeWorkspaceId = wsId;
      const cachedCwd = workspaceCwds.get(wsId);
      if (cachedCwd) {
        // Use cached CWD — safe, no race
        void refreshGitStatus(wsId, cachedCwd);
        void refreshPrStatus(wsId, cachedCwd);
      } else {
        void ensurePolling(wsId);
      }
    });

    api.on("workspace:created", (event) => {
      const wsId = event.id as string;
      if (!wsId) return;
      // New workspace's terminal is the active one; ensure we bind its CWD.
      void ensurePolling(wsId);
    });

    api.on("workspace:closed", (event) => {
      const wsId = event.id as string;
      if (!wsId) return;
      stopPolling(wsId);
      api.clearAllStatus(wsId);
      prCache.delete(wsId);
      workspaceCwds.delete(wsId);
    });

    // Terminal output → debounced git refresh using cached CWD (not global)
    api.on("surface:titleChanged", () => {
      if (!activeWorkspaceId) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (!activeWorkspaceId) return;
        const cachedCwd = workspaceCwds.get(activeWorkspaceId);
        if (cachedCwd) {
          void refreshGitStatus(activeWorkspaceId, cachedCwd);
        }
      }, 2000);
    });
  });
}
