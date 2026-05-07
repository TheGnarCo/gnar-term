<script lang="ts">
  /**
   * Prs — renders `gh pr list` output inside a markdown doc. Read-only
   * sibling of `Issues.svelte`: each row links to the PR on GitHub but
   * does not offer a Spawn affordance. PR work in gnar-term is anchored
   * on the branch already, so the row's only action is "open in
   * browser" — anything beyond that lives in the per-workspace status
   * registry / Diff dashboard tile.
   *
   * Scope derives from the enclosing DashboardHostContext:
   *   - workspace host → workspace.path backs the default repo
   *   - global host → caller must set `repoPath`; otherwise shown as error
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
    timeAgo,
  } from "../widget-helpers";
  import {
    isGhAvailable,
    invalidateGhAvailability,
  } from "../../../lib/services/gh-availability";
  import {
    deriveDashboardScope,
    getDashboardHost,
  } from "../../../lib/contexts/dashboard-host";

  export let repoPath: string | undefined = undefined;
  export let repo: string | undefined = undefined;
  export let state: "open" | "closed" | "all" = "open";
  export let limit: number = 25;

  const host = getDashboardHost();
  const scope = deriveDashboardScope(host);

  function resolveTarget() {
    return resolveSpawnTarget(scope, repoPath);
  }

  interface GhPr {
    number: number;
    title: string;
    state: string;
    url: string;
    headRefName: string;
    isDraft: boolean;
    author?: { login: string };
    createdAt?: string;
  }

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;

  let prs: GhPr[] = [];
  let loading = false;
  let error = "";
  let ghMissing = false;
  let lastFetchAt = 0;

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

  async function fetchPrs(options: { force?: boolean } = {}) {
    if (!(await isGhAvailable())) {
      ghMissing = true;
      prs = [];
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
      return;
    }

    loading = true;
    error = "";
    ghMissing = false;
    try {
      const result = await api.invoke<GhPr[]>("gh_list_prs", {
        repoPath: resolvedRepoPath ?? ".",
        state,
      });
      prs = Array.isArray(result) ? result.slice(0, limit) : [];
      lastFetchAt = Date.now();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isGhMissing(msg)) {
        ghMissing = true;
      } else {
        error = `Failed to load PRs: ${msg}`;
      }
      prs = [];
    } finally {
      loading = false;
    }
  }

  function refresh() {
    void fetchPrs({ force: true });
  }

  function retryGhProbe() {
    invalidateGhAvailability();
    ghMissing = false;
    void fetchPrs({ force: true });
  }

  function openPr(url: string) {
    void api.invoke("open_url", { url }).catch(() => {
      // No-op — the URL is in the row tooltip if the open fails.
    });
  }

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  onMount(() => {
    void fetchPrs({ force: true });
    pollTimer = setInterval(() => {
      void fetchPrs();
    }, GH_POLL_THROTTLE_MS);
  });
  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
  });
</script>

<div
  data-prs
  {...scopeAttrs(scope)}
  style="
    display: flex; flex-direction: column; gap: 6px;
    padding: 12px; border: 1px solid {$theme.border};
    border-radius: 6px; background: {$theme.bgSurface};
  "
>
  <div
    data-prs-header
    style="
      display: flex; align-items: center; gap: 8px;
      font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.5px; color: {$theme.fgDim};
    "
  >
    <span>Pull Requests ({state})</span>
    <span style="margin-left: auto; color: {$theme.fgDim};">{prs.length}</span>
    <button
      data-prs-refresh
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

  {#if loading && prs.length === 0}
    <div
      data-prs-loading
      style="color: {$theme.fgDim}; font-style: italic; font-size: 12px;"
    >
      Loading PRs...
    </div>
  {:else if ghMissing}
    <div
      data-prs-gh-missing
      style="
        display: flex; flex-direction: column; gap: 6px;
        padding: 8px 10px; border-radius: 4px;
        border: 1px solid {$theme.border}; background: {$theme.bg};
      "
    >
      <div
        data-prs-gh-missing-title
        style="color: {$theme.fg}; font-size: 12px; font-weight: 600;"
      >
        GitHub CLI not available
      </div>
      <div style="color: {$theme.fgDim}; font-size: 11px; line-height: 1.5;">
        Install <code style="font-family: monospace;">gh</code> then run
        <code style="font-family: monospace;">gh auth login</code> to fetch PRs for
        this dashboard.
      </div>
      <div style="display: flex; gap: 6px;">
        <button
          data-prs-gh-missing-retry
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
    <div data-prs-error style="color: {$theme.danger}; font-size: 12px;">
      {error}
    </div>
  {:else if prs.length === 0}
    <div
      data-prs-empty
      style="color: {$theme.fgDim}; font-style: italic; font-size: 12px; padding: 6px 0;"
    >
      No {state} PRs
    </div>
  {:else}
    {#each prs as pr (pr.number)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        data-pr-row
        data-pr-number={pr.number}
        on:click={() => openPr(pr.url)}
        title={`#${pr.number} ${pr.title}\n${pr.url}`}
        style="
          display: flex; align-items: center; gap: 8px;
          padding: 6px 8px;
          border: 1px solid {$theme.border}; border-radius: 4px;
          color: {$theme.fg}; font-size: 12px;
          background: {$theme.bg};
          cursor: pointer;
        "
      >
        <span style="color: {$theme.fgDim}; font-size: 11px; flex-shrink: 0;"
          >#{pr.number}</span
        >
        <span
          data-pr-title
          style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0;"
          >{pr.title}</span
        >
        {#if pr.isDraft}
          <span
            data-pr-draft
            style="
              background: {$theme.bgHighlight ?? $theme.bgSurface};
              color: {$theme.fgDim};
              padding: 0 6px; border-radius: 3px; font-size: 10px;
              line-height: 16px; flex-shrink: 0;
            ">draft</span
          >
        {/if}
        {#if pr.author?.login}
          <span
            data-pr-author
            style="color: {$theme.fgDim}; font-size: 11px; flex-shrink: 0;"
            >{pr.author.login}</span
          >
        {/if}
        {#if pr.createdAt}
          <span
            data-pr-age
            style="color: {$theme.fgDim}; font-size: 11px; flex-shrink: 0;"
            >{timeAgo(pr.createdAt)}</span
          >
        {/if}
      </div>
    {/each}
  {/if}
</div>
