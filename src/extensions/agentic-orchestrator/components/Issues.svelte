<script lang="ts">
  /**
   * Issues — renders `gh issue list` output inside a markdown doc.
   * Scope derives from the enclosing DashboardHostContext:
   *   - workspace host → workspace.path backs the default repo + spawn target
   *   - global host → caller must set `repoPath`; otherwise shown as error
   *   - no host → form disabled
   *
   * Per-row affordance is state-dependent:
   *   - Issue already has an active workspace (matched by workspace
   *     metadata.spawnedFromIssues) → renders a bot-icon button. Click
   *     switches to that workspace.
   *   - Issue is unhandled → renders a Spawn split-button (default
   *     claude-code; caret picks codex / aider / custom) plus a
   *     selection checkbox.
   *
   * Multi-select bulk actions:
   *   - "Spawn All" — fan out one workspace per selected issue.
   *   - "Spawn Together" — single workspace, single agent prompt, lists
   *     every selected issue. Stamps `spawnedFromIssues` with all
   *     numbers so the bot-icon attribution lights up for each.
   *
   * Refresh indicator: the header Refresh button is disabled and labelled
   * "Refreshing..." while a fetch is in flight.
   *
   * Config:
   *   repoPath?: string      — override / required under global scope
   *   repo?: string          — owner/name (falls back to gh inference from repoPath)
   *   state?: "open" | "closed" | "all"  (default "open")
   *   limit?: number         (default 25)
   */
  import { getContext, onDestroy, onMount } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../../api";
  import {
    GH_POLL_THROTTLE_MS,
    resolveSpawnTarget,
    scopeAttrs,
    slugify,
    timeAgo,
    SPAWN_AGENT_OPTIONS,
  } from "../widget-helpers";
  import {
    spawnAgentInWorktree,
    type SpawnAgentType,
  } from "../../../lib/services/spawn-helper";
  import {
    isGhAvailable,
    invalidateGhAvailability,
  } from "../../../lib/services/gh-availability";
  import {
    deriveDashboardScope,
    getDashboardHost,
  } from "../../../lib/contexts/dashboard-host";
  import BotIcon from "../icons/BotIcon.svelte";

  export let repoPath: string | undefined = undefined;
  export let repo: string | undefined = undefined;
  export let state: "open" | "closed" | "all" = "open";
  export let limit: number = 25;
  /**
   * When true, the per-row Spawn split-button + selection checkbox +
   * bulk toolbar are suppressed. The bot-icon "active workspace" link
   * is still shown so the Overview dashboard can hint at attribution.
   * Used by the Workspace Overview Dashboard, where the issue list is a
   * passive browse panel and spawning lives on the Agent Dashboard.
   */
  export let displayOnly: boolean = false;

  const host = getDashboardHost();
  const scope = deriveDashboardScope(host);

  function resolveTarget() {
    return resolveSpawnTarget(scope, repoPath);
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
  /** True while a bulk Spawn All / Spawn Together is running. */
  let bulkSpawning = false;
  let spawnError = "";

  /**
   * Selected issue numbers. Drives the bulk-action toolbar and clears
   * automatically after a successful Spawn All / Spawn Together. Issues
   * that are already handled (have an active workspace) cannot be
   * selected — the bot-icon replaces the checkbox in that case.
   */
  let selectedIssues = new Set<number>();

  function toggleIssueSelection(issueNumber: number, next: boolean) {
    const set = new Set(selectedIssues);
    if (next) set.add(issueNumber);
    else set.delete(issueNumber);
    selectedIssues = set;
  }

  function clearSelection() {
    selectedIssues = new Set();
  }

  /**
   * Subscribe to the nestedWorkspaces store so the per-row affordance updates
   * live as agent nestedWorkspaces are spawned / closed. Keyed lookup: issue
   * number → first workspace whose `metadata.spawnedFromIssues` array
   * includes that number.
   */
  const workspacesStore = api.nestedWorkspaces;
  $: handledIssues = (() => {
    const map = new Map<number, string>();
    for (const ws of $workspacesStore) {
      const numbers = ws.metadata?.spawnedFromIssues;
      if (!Array.isArray(numbers)) continue;
      for (const n of numbers) {
        if (typeof n === "number" && !map.has(n)) map.set(n, ws.id);
      }
    }
    return map;
  })();

  function jumpToHandledWorkspace(issueNumber: number) {
    const wsId = handledIssues.get(issueNumber);
    if (wsId) api.switchNestedWorkspace(wsId);
  }

  function isGhMissing(msg: string): boolean {
    return (
      msg.includes("gh") &&
      (msg.includes("not found") || msg.includes("not installed"))
    );
  }

  function resolveRepoPath(): string | null {
    const t = resolveTarget();
    return t.ok ? t.repoPath : null;
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
    if (!target.ok) {
      spawnError = `Cannot spawn: ${target.error}`;
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
        spawnedBy: target.spawnedBy,
        ...(target.parentWorkspaceId
          ? { parentWorkspaceId: target.parentWorkspaceId }
          : {}),
        spawnedFromIssues: [issue.number],
      });
      toggleIssueSelection(issue.number, false);
    } catch (err) {
      spawnError = `Spawn failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      spawningRow = null;
    }
  }

  /**
   * Spawn a separate worktree workspace per selected issue, in
   * sequence. Sequential (not parallel) to avoid hammering git with
   * concurrent worktree creates and to keep error attribution sharp —
   * if one issue fails, later issues still spawn so the user gets
   * partial progress instead of an all-or-nothing.
   */
  async function spawnAllSelected(agent: SpawnAgentType = "claude-code") {
    if (selectedIssues.size === 0) return;
    const target = resolveTarget();
    if (!target.ok) {
      spawnError = `Cannot spawn: ${target.error}`;
      return;
    }
    spawnError = "";
    bulkSpawning = true;
    const failures: string[] = [];
    try {
      // Snapshot order matches the rendered list so the spawn cadence
      // mirrors what the user sees.
      const ordered = issues.filter((i) => selectedIssues.has(i.number));
      for (const issue of ordered) {
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
            spawnedBy: target.spawnedBy,
            ...(target.parentWorkspaceId
              ? { parentWorkspaceId: target.parentWorkspaceId }
              : {}),
            spawnedFromIssues: [issue.number],
          });
        } catch (err) {
          failures.push(
            `#${issue.number}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      if (failures.length > 0) {
        spawnError = `Spawn All: ${failures.length} of ${ordered.length} failed — ${failures.join("; ")}`;
      } else {
        clearSelection();
      }
    } finally {
      bulkSpawning = false;
    }
  }

  /**
   * Spawn a single worktree workspace whose agent prompt enumerates
   * every selected issue. Stamps `spawnedFromIssues` with all numbers
   * so the bot-icon attribution lights up for each row, all pointing
   * at the same workspace.
   */
  async function spawnTogetherSelected(agent: SpawnAgentType = "claude-code") {
    if (selectedIssues.size === 0) return;
    const target = resolveTarget();
    if (!target.ok) {
      spawnError = `Cannot spawn: ${target.error}`;
      return;
    }
    const ordered = issues.filter((i) => selectedIssues.has(i.number));
    if (ordered.length === 0) return;

    spawnError = "";
    bulkSpawning = true;
    try {
      const numbers = ordered.map((i) => i.number);
      const lines = ordered.map(
        (i) => `- Issue #${i.number}: ${i.title}\n  ${i.url}`,
      );
      const taskContext = [
        `Multi-issue task — please address all of the following:`,
        "",
        ...lines,
      ].join("\n");
      const numbersForBranch = numbers.slice(0, 4).join("-");
      const branchSuffix =
        numbers.length > 4
          ? `together-${numbersForBranch}-and-${numbers.length - 4}-more`
          : `together-${numbersForBranch}`;
      const displayNumbers = numbers
        .slice(0, 3)
        .map((n) => `#${n}`)
        .join(" ");
      const nameSuffix =
        numbers.length > 3
          ? `${displayNumbers} +${numbers.length - 3}`
          : displayNumbers;
      await spawnAgentInWorktree({
        name: `${agent}: ${nameSuffix}`,
        agent,
        ...(agent === "custom" ? { command: agent } : {}),
        taskContext,
        repoPath: target.repoPath,
        branch: `agent/${agent}/${branchSuffix}`,
        spawnedBy: target.spawnedBy,
        ...(target.parentWorkspaceId
          ? { parentWorkspaceId: target.parentWorkspaceId }
          : {}),
        spawnedFromIssues: numbers,
      });
      clearSelection();
    } catch (err) {
      spawnError = `Spawn Together failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      bulkSpawning = false;
    }
  }

  function openIssue(url: string) {
    void api.invoke("open_url", { url }).catch(() => {});
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
  {...scopeAttrs(scope)}
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
      data-refreshing={loading ? "true" : undefined}
      on:click={refresh}
      disabled={loading}
      title={loading ? "Refreshing..." : "Refresh"}
      style="
        background: transparent; color: {$theme.fgDim};
        border: 1px solid {$theme.border}; border-radius: 3px;
        padding: 2px 6px; font-size: 10px;
        cursor: {loading ? 'wait' : 'pointer'};
        opacity: {loading ? 0.6 : 1};
      "
    >
      {loading ? "Refreshing..." : "Refresh"}
    </button>
  </div>

  {#if !displayOnly}
    <div
      data-issues-bulk-toolbar
      data-selection-count={selectedIssues.size}
      style="
        display: flex; align-items: center; gap: 8px;
        padding: 6px 8px; border-radius: 4px;
        background: {$theme.bgHighlight ?? $theme.bgSurface};
        border: 1px solid {$theme.border};
      "
    >
      <span style="font-size: 11px; color: {$theme.fg}; flex: 1;">
        {selectedIssues.size} selected
      </span>
      <button
        data-issues-spawn-all
        type="button"
        on:click={() => void spawnAllSelected()}
        disabled={bulkSpawning || selectedIssues.size === 0}
        title="Spawn one workspace per selected issue (claude-code)"
        style="
          background: transparent; color: {$theme.fg};
          border: 1px solid {$theme.border}; border-radius: 3px;
          padding: 2px 8px; font-size: 11px;
          cursor: {bulkSpawning || selectedIssues.size === 0
          ? 'not-allowed'
          : 'pointer'};
          opacity: {bulkSpawning || selectedIssues.size === 0 ? 0.4 : 1};
        "
      >
        {bulkSpawning ? "Spawning..." : "Spawn All"}
      </button>
      <button
        data-issues-spawn-together
        type="button"
        on:click={() => void spawnTogetherSelected()}
        disabled={bulkSpawning || selectedIssues.size < 2}
        title={selectedIssues.size < 2
          ? "Select 2 or more issues to spawn together"
          : "Spawn one workspace whose prompt references all selected issues"}
        style="
          background: transparent; color: {$theme.fg};
          border: 1px solid {$theme.border}; border-radius: 3px;
          padding: 2px 8px; font-size: 11px;
          cursor: {bulkSpawning || selectedIssues.size < 2
          ? 'not-allowed'
          : 'pointer'};
          opacity: {bulkSpawning || selectedIssues.size < 2 ? 0.4 : 1};
        "
      >
        Spawn Together
      </button>
      <button
        data-issues-bulk-clear
        type="button"
        on:click={clearSelection}
        disabled={bulkSpawning || selectedIssues.size === 0}
        style="
          background: transparent; color: {$theme.fgDim};
          border: 1px solid {$theme.border}; border-radius: 3px;
          padding: 2px 8px; font-size: 11px;
          cursor: {bulkSpawning || selectedIssues.size === 0
          ? 'not-allowed'
          : 'pointer'};
          opacity: {bulkSpawning || selectedIssues.size === 0 ? 0.4 : 1};
        "
      >
        Clear
      </button>
    </div>
  {/if}

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
      {@const handledWorkspaceId = handledIssues.get(issue.number)}
      {@const isHandled = Boolean(handledWorkspaceId)}
      {@const isSelected = selectedIssues.has(issue.number)}
      <div
        data-issue-row
        data-issue-number={issue.number}
        data-issue-handled={isHandled ? "true" : undefined}
        style="
          display: flex; align-items: center; gap: 8px;
          padding: 6px 8px;
          border: 1px solid {$theme.border}; border-radius: 4px;
          color: {$theme.fg}; font-size: 12px;
          background: {$theme.bg};
        "
      >
        {#if !displayOnly && !isHandled}
          <input
            data-issue-select
            type="checkbox"
            checked={isSelected}
            on:change={(e) =>
              toggleIssueSelection(
                issue.number,
                (e.currentTarget as HTMLInputElement).checked,
              )}
            disabled={bulkSpawning || spawningRow === issue.number}
            aria-label={`Select issue #${issue.number}`}
            style="flex-shrink: 0; cursor: pointer;"
          />
        {/if}
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
        <button
          data-issue-open-browser
          type="button"
          on:click={() => openIssue(issue.url)}
          title="Open in browser"
          aria-label={`Open issue #${issue.number} in browser`}
          style="
            flex-shrink: 0;
            display: inline-flex; align-items: center; justify-content: center;
            width: 24px; height: 22px;
            padding: 0; border-radius: 3px;
            background: transparent; color: {$theme.fgDim};
            border: 1px solid {$theme.border};
            cursor: pointer; font-size: 12px;
          "
        >
          ↗
        </button>
        {#if isHandled}
          <button
            data-issue-jump
            data-issue-handled-workspace={handledWorkspaceId}
            type="button"
            on:click={() => jumpToHandledWorkspace(issue.number)}
            title="Jump to the agent workspace handling this issue"
            aria-label={`Open active workspace for issue #${issue.number}`}
            style="
              flex-shrink: 0;
              display: inline-flex; align-items: center; justify-content: center;
              width: 24px; height: 22px;
              padding: 0; border-radius: 3px;
              background: transparent; color: {$theme.fg};
              border: 1px solid {$theme.border};
              cursor: pointer;
            "
          >
            <BotIcon size={14} />
          </button>
        {:else if !displayOnly}
          <div
            data-issue-spawn-group
            style="position: relative; display: inline-flex; align-items: stretch; flex-shrink: 0;"
          >
            <button
              data-issue-spawn
              on:click={() => spawnForIssue(issue, "claude-code")}
              disabled={isSelected || spawningRow === issue.number}
              title={isSelected
                ? "Deselect to spawn individually"
                : "Spawn claude-code on this issue"}
              style="
              background: transparent; color: {$theme.fg};
              border: 1px solid {$theme.border}; border-right: none;
              border-radius: 3px 0 0 3px;
              padding: 2px 8px; font-size: 10px;
              cursor: {isSelected || spawningRow === issue.number
                ? 'not-allowed'
                : 'pointer'};
              opacity: {isSelected || spawningRow === issue.number ? 0.4 : 1};
            "
            >
              {spawningRow === issue.number ? "Spawning..." : "Spawn"}
            </button>
            <button
              data-issue-spawn-caret
              on:click={() => toggleSpawnMenu(issue.number)}
              disabled={isSelected || spawningRow === issue.number}
              aria-label="Choose agent"
              aria-haspopup="menu"
              aria-expanded={openSpawnMenu === issue.number}
              title={isSelected
                ? "Deselect to spawn individually"
                : "Choose agent"}
              style="
              background: {openSpawnMenu === issue.number
                ? $theme.bgHighlight
                : 'transparent'};
              color: {$theme.fgDim};
              border: 1px solid {$theme.border}; border-radius: 0 3px 3px 0;
              padding: 2px 6px; font-size: 10px;
              cursor: {isSelected || spawningRow === issue.number
                ? 'not-allowed'
                : 'pointer'};
              opacity: {isSelected ? 0.4 : 1};
            "
            >
              ▾
            </button>
            {#if openSpawnMenu === issue.number}
              <div
                role="menu"
                data-issue-spawn-dropdown
                style="
                position: absolute; top: 100%; right: 0; margin-top: 2px;
                background: {$theme.bgFloat ?? $theme.bgSurface};
                border: 1px solid {$theme.border}; border-radius: 4px;
                padding: 4px; min-width: 140px; z-index: 9999;
                box-shadow: 0 4px 12px rgba(0,0,0,0.4);
              "
              >
                {#each SPAWN_AGENT_OPTIONS as opt (opt.id)}
                  <div
                    role="menuitem"
                    tabindex="-1"
                    data-issue-spawn-option={opt.id}
                    on:click={() => spawnForIssue(issue, opt.id)}
                    on:keydown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        void spawnForIssue(issue, opt.id);
                      }
                    }}
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
        {/if}
      </div>
    {/each}
    {#if spawnError && !displayOnly}
      <div
        data-issues-spawn-error
        style="color: {$theme.danger}; font-size: 11px;"
      >
        {spawnError}
      </div>
    {/if}
  {/if}
</div>
