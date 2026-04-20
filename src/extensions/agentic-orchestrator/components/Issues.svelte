<script lang="ts">
  /**
   * Issues — renders `gh issue list` output inside a markdown doc.
   * Scope derives from the enclosing DashboardHostContext:
   *   - group host → group.path backs the default repo + spawn target
   *   - global host → caller must set `repoPath`; otherwise shown as error
   *   - no host → form disabled
   *
   * Each row has a split button: default click spawns claude-code on the
   * issue (in a fresh worktree workspace tagged to the dashboard); the
   * caret opens an agent picker (codex / aider / custom).
   *
   * Config:
   *   repoPath?: string      — override / required under global scope
   *   repo?: string          — owner/name (falls back to gh inference from repoPath)
   *   state?: "open" | "closed" | "all"  (default "open")
   *   limit?: number         (default 25)
   */
  import { getContext, onDestroy, onMount } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../../api";
  import { GH_POLL_THROTTLE_MS, slugify, timeAgo } from "../widget-helpers";
  import {
    spawnAgentInWorktree,
    type SpawnAgentType,
    type SpawnedByMarker,
  } from "../../../lib/services/spawn-helper";
  import {
    isGhAvailable,
    invalidateGhAvailability,
  } from "../../../lib/services/gh-availability";
  import {
    deriveDashboardScope,
    getDashboardHost,
  } from "../../../lib/contexts/dashboard-host";
  import { getWorkspaceGroup } from "../../../lib/stores/workspace-groups";

  export let repoPath: string | undefined = undefined;
  export let repo: string | undefined = undefined;
  export let state: "open" | "closed" | "all" = "open";
  export let limit: number = 25;

  const host = getDashboardHost();
  const scope = deriveDashboardScope(host);

  interface ResolvedTarget {
    repoPath: string | null;
    spawnedBy?: SpawnedByMarker;
    groupId?: string;
  }

  function resolveTarget(): ResolvedTarget {
    if (scope.kind === "group") {
      const group = getWorkspaceGroup(scope.groupId);
      return group
        ? {
            repoPath: group.path,
            spawnedBy: { kind: "group", groupId: scope.groupId },
            groupId: scope.groupId,
          }
        : { repoPath: null };
    }
    if (scope.kind === "global") {
      return repoPath
        ? { repoPath, spawnedBy: { kind: "global" } }
        : { repoPath: null };
    }
    return { repoPath: null };
  }

  interface GhLabel {
    name: string;
    color: string;
  }

  interface GhIssue {
    number: number;
    title: string;
    state: string;
    author: { login: string };
    labels: GhLabel[];
    created_at: string;
    url: string;
  }

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;

  let issues: GhIssue[] = [];
  let loading = false;
  let error = "";
  let ghMissing = false;
  let lastFetchAt = 0;

  /** Per-row dropdown open state. Keyed by issue number. */
  let openSpawnMenu: number | null = null;
  /** Per-row spawn-in-flight state. Keyed by issue number. */
  let spawningRow: number | null = null;
  let spawnError = "";

  const SPAWN_AGENTS: Array<{ id: SpawnAgentType; label: string }> = [
    { id: "claude-code", label: "Claude Code" },
    { id: "codex", label: "Codex" },
    { id: "aider", label: "Aider" },
    { id: "custom", label: "Custom..." },
  ];

  function isGhMissing(msg: string): boolean {
    return (
      msg.includes("gh") &&
      (msg.includes("not found") || msg.includes("not installed"))
    );
  }

  function resolveRepoPath(): string | null {
    return resolveTarget().repoPath;
  }

  async function fetchIssues(options: { force?: boolean } = {}) {
    // Ask the shared cache whether gh is available before invoking — the
    // Tauri command itself exists, so a "command not found" error would
    // come from `gh` missing on PATH, not from the extension barrier.
    // Short-circuiting here avoids the noisy error path entirely.
    if (!(await isGhAvailable())) {
      ghMissing = true;
      issues = [];
      return;
    }

    const resolvedRepoPath = resolveRepoPath();
    if (!resolvedRepoPath && !repo) {
      error = "No repo: widget needs a dashboard host or a `repo` config";
      return;
    }

    const now = Date.now();
    if (
      !options.force &&
      lastFetchAt > 0 &&
      now - lastFetchAt < GH_POLL_THROTTLE_MS
    ) {
      return; // Throttled
    }

    loading = true;
    error = "";
    ghMissing = false;
    try {
      const result = await api.invoke<GhIssue[]>("gh_list_issues", {
        repoPath: resolvedRepoPath ?? ".",
        state,
      });
      issues = Array.isArray(result) ? result.slice(0, limit) : [];
      lastFetchAt = Date.now();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isGhMissing(msg)) {
        ghMissing = true;
      } else {
        error = `Failed to load issues: ${msg}`;
      }
      issues = [];
    } finally {
      loading = false;
    }
  }

  function refresh() {
    void fetchIssues({ force: true });
  }

  function retryGhProbe() {
    invalidateGhAvailability();
    ghMissing = false;
    void fetchIssues({ force: true });
  }

  async function spawnForIssue(issue: GhIssue, agent: SpawnAgentType) {
    const target = resolveTarget();
    if (!target.repoPath) {
      spawnError = "Cannot spawn: no dashboard host or repoPath resolved.";
      return;
    }
    spawnError = "";
    spawningRow = issue.number;
    openSpawnMenu = null;
    try {
      const taskContext = `Issue #${issue.number}: ${issue.title}\n${issue.url}`;
      const branchSlug = slugify(issue.title).slice(0, 30) || "task";
      await spawnAgentInWorktree({
        name: `${agent}: #${issue.number} ${issue.title}`,
        agent,
        ...(agent === "custom" ? { command: agent } : {}),
        taskContext,
        repoPath: target.repoPath,
        branch: `agent/${agent}/${issue.number}-${branchSlug}`,
        ...(target.spawnedBy ? { spawnedBy: target.spawnedBy } : {}),
        ...(target.groupId ? { groupId: target.groupId } : {}),
      });
    } catch (err) {
      spawnError = `Spawn failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      spawningRow = null;
    }
  }

  function toggleSpawnMenu(issueNumber: number) {
    openSpawnMenu = openSpawnMenu === issueNumber ? null : issueNumber;
  }

  // Auto-poll: one fetch on mount, further polls via user refresh.
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  onMount(() => {
    void fetchIssues({ force: true });
    pollTimer = setInterval(() => {
      void fetchIssues();
    }, GH_POLL_THROTTLE_MS);
  });
  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
  });

  function labelColor(hex: string): string {
    const clean = hex.replace(/^#/, "");
    return `#${clean}`;
  }

  function labelTextColor(hex: string): string {
    const clean = hex.replace(/^#/, "");
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.5 ? "#000" : "#fff";
  }
</script>

<div
  data-issues
  data-scope-kind={scope.kind}
  data-scope-group-id={scope.kind === "group" ? scope.groupId : ""}
  style="
    display: flex; flex-direction: column; gap: 6px;
    padding: 12px; border: 1px solid {$theme.border};
    border-radius: 6px; background: {$theme.bgSurface};
  "
>
  <div
    data-issues-header
    style="
      display: flex; align-items: center; gap: 8px;
      font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.5px; color: {$theme.fgDim};
    "
  >
    <span>Issues ({state})</span>
    <span style="margin-left: auto; color: {$theme.fgDim};"
      >{issues.length}</span
    >
    <button
      data-issues-refresh
      on:click={refresh}
      title="Refresh"
      style="
        background: transparent; color: {$theme.fgDim};
        border: 1px solid {$theme.border}; border-radius: 3px;
        padding: 2px 6px; font-size: 10px; cursor: pointer;
      "
    >
      Refresh
    </button>
  </div>

  {#if loading && issues.length === 0}
    <div
      data-issues-loading
      style="color: {$theme.fgDim}; font-style: italic; font-size: 12px;"
    >
      Loading issues...
    </div>
  {:else if ghMissing}
    <div
      data-issues-gh-missing
      style="
        display: flex; flex-direction: column; gap: 6px;
        padding: 8px 10px; border-radius: 4px;
        border: 1px solid {$theme.border}; background: {$theme.bg};
      "
    >
      <div
        data-issues-gh-missing-title
        style="color: {$theme.fg}; font-size: 12px; font-weight: 600;"
      >
        GitHub CLI not available
      </div>
      <div style="color: {$theme.fgDim}; font-size: 11px; line-height: 1.5;">
        Install <code style="font-family: monospace;">gh</code> then run
        <code style="font-family: monospace;">gh auth login</code> to fetch issues
        for this dashboard.
      </div>
      <div style="display: flex; gap: 6px;">
        <button
          data-issues-gh-missing-retry
          type="button"
          on:click={retryGhProbe}
          style="
            background: transparent; color: {$theme.fg};
            border: 1px solid {$theme.border}; border-radius: 3px;
            padding: 2px 10px; font-size: 11px; cursor: pointer;
          "
        >
          Retry
        </button>
      </div>
    </div>
  {:else if error}
    <div data-issues-error style="color: {$theme.danger}; font-size: 12px;">
      {error}
    </div>
  {:else if issues.length === 0}
    <div
      data-issues-empty
      style="color: {$theme.fgDim}; font-style: italic; font-size: 12px; padding: 6px 0;"
    >
      No {state} issues
    </div>
  {:else}
    {#each issues as issue (issue.number)}
      <div
        data-issue-row
        data-issue-number={issue.number}
        style="
          display: flex; align-items: center; gap: 8px;
          padding: 6px 8px;
          border: 1px solid {$theme.border}; border-radius: 4px;
          color: {$theme.fg}; font-size: 12px;
          background: {$theme.bg};
        "
      >
        <span style="color: {$theme.fgDim}; font-size: 11px; flex-shrink: 0;"
          >#{issue.number}</span
        >
        <span
          data-issue-title
          style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0;"
          >{issue.title}</span
        >
        <div data-issue-labels style="display: flex; gap: 4px; flex-shrink: 0;">
          {#each issue.labels as label (label.name)}
            <span
              style="
                background: {labelColor(label.color)};
                color: {labelTextColor(label.color)};
                padding: 0 4px; border-radius: 3px; font-size: 10px;
                line-height: 16px;
              ">{label.name}</span
            >
          {/each}
        </div>
        <span
          data-issue-author
          style="color: {$theme.fgDim}; font-size: 11px; flex-shrink: 0;"
        >
          {issue.author.login}
        </span>
        <span
          data-issue-age
          style="color: {$theme.fgDim}; font-size: 11px; flex-shrink: 0;"
          >{timeAgo(issue.created_at)}</span
        >
        <div
          data-issue-spawn-group
          style="position: relative; display: inline-flex; align-items: stretch; flex-shrink: 0;"
        >
          <button
            data-issue-spawn
            on:click={() => spawnForIssue(issue, "claude-code")}
            disabled={spawningRow === issue.number}
            title="Spawn claude-code on this issue"
            style="
              background: transparent; color: {$theme.fg};
              border: 1px solid {$theme.border}; border-right: none;
              border-radius: 3px 0 0 3px;
              padding: 2px 8px; font-size: 10px;
              cursor: {spawningRow === issue.number ? 'wait' : 'pointer'};
              opacity: {spawningRow === issue.number ? 0.6 : 1};
            "
          >
            {spawningRow === issue.number ? "Spawning..." : "Spawn"}
          </button>
          <button
            data-issue-spawn-caret
            on:click={() => toggleSpawnMenu(issue.number)}
            disabled={spawningRow === issue.number}
            title="Choose agent"
            style="
              background: {openSpawnMenu === issue.number
              ? $theme.bgHighlight
              : 'transparent'};
              color: {$theme.fgDim};
              border: 1px solid {$theme.border}; border-radius: 0 3px 3px 0;
              padding: 2px 6px; font-size: 10px;
              cursor: {spawningRow === issue.number ? 'wait' : 'pointer'};
            "
          >
            ▾
          </button>
          {#if openSpawnMenu === issue.number}
            <div
              data-issue-spawn-dropdown
              style="
                position: absolute; top: 100%; right: 0; margin-top: 2px;
                background: {$theme.bgFloat ?? $theme.bgSurface};
                border: 1px solid {$theme.border}; border-radius: 4px;
                padding: 4px; min-width: 140px; z-index: 9999;
                box-shadow: 0 4px 12px rgba(0,0,0,0.4);
              "
            >
              {#each SPAWN_AGENTS as opt (opt.id)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  data-issue-spawn-option={opt.id}
                  on:click={() => spawnForIssue(issue, opt.id)}
                  style="
                    padding: 4px 8px; cursor: pointer; font-size: 12px;
                    color: {$theme.fg}; border-radius: 3px;
                  "
                  on:mouseenter={(e) => {
                    const el = e.currentTarget;
                    if (el instanceof HTMLElement)
                      el.style.background = $theme.bgHighlight;
                  }}
                  on:mouseleave={(e) => {
                    const el = e.currentTarget;
                    if (el instanceof HTMLElement)
                      el.style.background = "transparent";
                  }}
                >
                  {opt.label}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    {/each}
    {#if spawnError}
      <div
        data-issues-spawn-error
        style="color: {$theme.danger}; font-size: 11px;"
      >
        {spawnError}
      </div>
    {/if}
  {/if}
</div>
