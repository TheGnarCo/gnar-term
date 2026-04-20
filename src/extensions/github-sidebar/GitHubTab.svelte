<script lang="ts">
  import { onDestroy, onMount, getContext } from "svelte";
  import { writeText as clipboardWrite } from "@tauri-apps/plugin-clipboard-manager";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../api";

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;
  const activeWorkspace = api.activeWorkspace;

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

  interface GhPr {
    number: number;
    title: string;
    state: string;
    author: { login: string };
    labels: GhLabel[];
    created_at: string;
    url: string;
    head_ref_name: string;
    is_draft: boolean;
  }

  interface CommitInfo {
    hash: string;
    short_hash: string;
    author_name: string;
    author_email: string;
    subject: string;
    date: string;
  }

  interface CacheEntry {
    issues: GhIssue[];
    prs: GhPr[];
    commits: CommitInfo[];
    isGitRepo: boolean;
    ghAvailable: boolean;
  }

  // Per-cwd cache survives tab unmount/remount so flipping between sidebar
  // tabs doesn't refetch from gh on every visit.
  const cwdCache = new Map<string, CacheEntry>();

  let loading = false;
  let isGitRepo = false;
  let ghAvailable = true;
  let error = "";
  let cwd = "";

  let issues: GhIssue[] = [];
  let prs: GhPr[] = [];
  let commits: CommitInfo[] = [];

  let issuesCollapsed = false;
  let prsCollapsed = false;
  let commitsCollapsed = false;

  let issueError = "";
  let prError = "";
  let commitError = "";

  function isGhMissing(msg: string): boolean {
    return (
      msg.includes("gh") &&
      (msg.includes("not found") || msg.includes("not installed"))
    );
  }

  async function fetchData(forceRefresh = false) {
    const dir = await api.getActiveCwd();
    if (!dir) {
      isGitRepo = false;
      error = "No active workspace";
      return;
    }

    if (dir === cwd && !forceRefresh) {
      const cached = cwdCache.get(dir);
      if (cached) {
        issues = cached.issues;
        prs = cached.prs;
        commits = cached.commits;
        isGitRepo = cached.isGitRepo;
        ghAvailable = cached.ghAvailable;
        return;
      }
    }

    cwd = dir;
    loading = true;
    error = "";
    issueError = "";
    prError = "";
    commitError = "";

    try {
      isGitRepo = await api.invoke<boolean>("is_git_repo", { path: dir });
    } catch {
      isGitRepo = false;
      error = "Could not check git status";
      loading = false;
      return;
    }

    if (!isGitRepo) {
      error = "Not a git repository";
      issues = [];
      prs = [];
      commits = [];
      loading = false;
      return;
    }

    const [issueResult, prResult, commitResult] = await Promise.allSettled([
      api.invoke<GhIssue[]>("gh_list_issues", {
        repoPath: dir,
        state: "open",
      }),
      api.invoke<GhPr[]>("gh_list_prs", { repoPath: dir, state: "open" }),
      api.invoke<CommitInfo[]>("git_log", { repoPath: dir, count: 10 }),
    ]);

    if (issueResult.status === "fulfilled") {
      issues = issueResult.value;
      ghAvailable = true;
    } else {
      issues = [];
      const msg = String(issueResult.reason);
      if (isGhMissing(msg)) {
        ghAvailable = false;
        issueError = "gh CLI not available";
      } else {
        issueError = "Failed to load issues";
      }
    }

    if (prResult.status === "fulfilled") {
      prs = prResult.value;
    } else {
      prs = [];
      const msg = String(prResult.reason);
      if (isGhMissing(msg)) {
        ghAvailable = false;
        prError = "gh CLI not available";
      } else {
        prError = "Failed to load pull requests";
      }
    }

    if (commitResult.status === "fulfilled") {
      commits = commitResult.value;
    } else {
      commits = [];
      commitError = "Failed to load commits";
    }

    cwdCache.set(dir, {
      issues,
      prs,
      commits,
      isGitRepo,
      ghAvailable,
    });

    loading = false;
  }

  function refresh() {
    void fetchData(true);
  }

  async function copyToClipboard(url: string) {
    try {
      await clipboardWrite(url);
    } catch {
      // silently fail
    }
  }

  function formatDate(dateStr: string): string {
    try {
      const d = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays === 0) return "today";
      if (diffDays === 1) return "yesterday";
      if (diffDays < 30) return `${diffDays}d ago`;
      if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
      return `${Math.floor(diffDays / 365)}y ago`;
    } catch {
      return dateStr;
    }
  }

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

  onMount(() => {
    api.state.set("refresh", refresh);
    void fetchData();
  });

  onDestroy(() => {
    api.state.set("refresh", null);
  });

  // Re-fetch when the active workspace changes (cwd may differ).
  $: if ($activeWorkspace) {
    cwd = "";
    void fetchData();
  }
</script>

<div
  class="github-tab"
  style="flex: 1; overflow-y: auto; padding: 4px 0; font-size: 12px;"
>
  {#if loading}
    <div style="color: {$theme.fgDim}; padding: 12px; font-style: italic;">
      Loading...
    </div>
  {:else if error}
    <div style="color: {$theme.fgDim}; padding: 12px; font-style: italic;">
      {error}
    </div>
  {:else}
    <!-- Issues section -->
    <button
      class="section-header"
      style="
        width: 100%; background: none; border: none; border-bottom: 1px solid {$theme.border};
        padding: 6px 12px; color: {$theme.fg}; cursor: pointer;
        display: flex; align-items: center; gap: 4px;
        font-size: 11px; font-weight: 600; text-transform: uppercase;
        letter-spacing: 0.5px; text-align: left;
      "
      on:click={() => (issuesCollapsed = !issuesCollapsed)}
    >
      <span
        style="display: inline-block; transition: transform 0.15s; transform: rotate({issuesCollapsed
          ? '0deg'
          : '90deg'}); font-size: 10px; width: 12px;">{"\u203A"}</span
      >
      Issues
      {#if issues.length > 0}
        <span
          style="color: {$theme.fgDim}; font-weight: 400; margin-left: auto;"
          >{issues.length}</span
        >
      {/if}
    </button>

    {#if !issuesCollapsed}
      {#if issueError}
        <div
          style="color: {$theme.fgDim}; padding: 6px 12px; font-style: italic; font-size: 11px;"
        >
          {issueError}
        </div>
      {:else if issues.length === 0}
        <div
          style="color: {$theme.fgDim}; padding: 6px 12px; font-style: italic; font-size: 11px;"
        >
          No open issues
        </div>
      {:else}
        {#each issues as issue (issue.number)}
          <button
            class="list-item"
            style="
              width: 100%; background: none; border: none;
              padding: 4px 12px 4px 28px; color: {$theme.fg}; cursor: pointer;
              display: flex; flex-direction: column; gap: 2px;
              font-size: 12px; text-align: left;
            "
            title="Click to copy URL"
            on:click={() => copyToClipboard(issue.url)}
          >
            <div
              style="display: flex; align-items: baseline; gap: 4px; overflow: hidden;"
            >
              <span
                style="color: {$theme.fgDim}; font-size: 11px; flex-shrink: 0;"
                >#{issue.number}</span
              >
              <span
                style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                >{issue.title}</span
              >
            </div>
            <div
              style="display: flex; align-items: center; gap: 4px; flex-wrap: wrap;"
            >
              <span style="color: {$theme.fgDim}; font-size: 10px;"
                >{issue.author.login}</span
              >
              {#each issue.labels as label (label.name)}
                <span
                  style="
                    background: {labelColor(
                    label.color,
                  )}; color: {labelTextColor(label.color)};
                    padding: 0 4px; border-radius: 3px; font-size: 10px;
                    line-height: 16px; white-space: nowrap;
                  ">{label.name}</span
                >
              {/each}
            </div>
          </button>
        {/each}
      {/if}
    {/if}

    <!-- Pull Requests section -->
    <button
      class="section-header"
      style="
        width: 100%; background: none; border: none; border-bottom: 1px solid {$theme.border};
        padding: 6px 12px; color: {$theme.fg}; cursor: pointer;
        display: flex; align-items: center; gap: 4px;
        font-size: 11px; font-weight: 600; text-transform: uppercase;
        letter-spacing: 0.5px; text-align: left;
      "
      on:click={() => (prsCollapsed = !prsCollapsed)}
    >
      <span
        style="display: inline-block; transition: transform 0.15s; transform: rotate({prsCollapsed
          ? '0deg'
          : '90deg'}); font-size: 10px; width: 12px;">{"\u203A"}</span
      >
      Pull Requests
      {#if prs.length > 0}
        <span
          style="color: {$theme.fgDim}; font-weight: 400; margin-left: auto;"
          >{prs.length}</span
        >
      {/if}
    </button>

    {#if !prsCollapsed}
      {#if prError}
        <div
          style="color: {$theme.fgDim}; padding: 6px 12px; font-style: italic; font-size: 11px;"
        >
          {prError}
        </div>
      {:else if prs.length === 0}
        <div
          style="color: {$theme.fgDim}; padding: 6px 12px; font-style: italic; font-size: 11px;"
        >
          No open pull requests
        </div>
      {:else}
        {#each prs as pr (pr.number)}
          <button
            class="list-item"
            style="
              width: 100%; background: none; border: none;
              padding: 4px 12px 4px 28px; color: {pr.is_draft
              ? $theme.fgDim
              : $theme.fg}; cursor: pointer;
              display: flex; flex-direction: column; gap: 2px;
              font-size: 12px; text-align: left;
              {pr.is_draft ? 'font-style: italic;' : ''}
            "
            title="Click to copy URL"
            on:click={() => copyToClipboard(pr.url)}
          >
            <div
              style="display: flex; align-items: baseline; gap: 4px; overflow: hidden;"
            >
              <span
                style="color: {$theme.fgDim}; font-size: 11px; flex-shrink: 0;"
                >#{pr.number}</span
              >
              {#if pr.is_draft}
                <span
                  style="color: {$theme.fgDim}; font-size: 10px; flex-shrink: 0;"
                  >[draft]</span
                >
              {/if}
              <span
                style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                >{pr.title}</span
              >
            </div>
            <div
              style="display: flex; align-items: center; gap: 4px; overflow: hidden;"
            >
              <span style="color: {$theme.fgDim}; font-size: 10px;"
                >{pr.author.login}</span
              >
              <span
                style="color: {$theme.accent}; font-size: 10px; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                >{pr.head_ref_name}</span
              >
            </div>
          </button>
        {/each}
      {/if}
    {/if}

    <!-- Recent Commits section -->
    <button
      class="section-header"
      style="
        width: 100%; background: none; border: none; border-bottom: 1px solid {$theme.border};
        padding: 6px 12px; color: {$theme.fg}; cursor: pointer;
        display: flex; align-items: center; gap: 4px;
        font-size: 11px; font-weight: 600; text-transform: uppercase;
        letter-spacing: 0.5px; text-align: left;
      "
      on:click={() => (commitsCollapsed = !commitsCollapsed)}
    >
      <span
        style="display: inline-block; transition: transform 0.15s; transform: rotate({commitsCollapsed
          ? '0deg'
          : '90deg'}); font-size: 10px; width: 12px;">{"\u203A"}</span
      >
      Recent Commits
      {#if commits.length > 0}
        <span
          style="color: {$theme.fgDim}; font-weight: 400; margin-left: auto;"
          >{commits.length}</span
        >
      {/if}
    </button>

    {#if !commitsCollapsed}
      {#if commitError}
        <div
          style="color: {$theme.fgDim}; padding: 6px 12px; font-style: italic; font-size: 11px;"
        >
          {commitError}
        </div>
      {:else if commits.length === 0}
        <div
          style="color: {$theme.fgDim}; padding: 6px 12px; font-style: italic; font-size: 11px;"
        >
          No commits
        </div>
      {:else}
        {#each commits as commit (commit.hash)}
          <div
            class="list-item"
            style="
              padding: 4px 12px 4px 28px; color: {$theme.fg};
              display: flex; flex-direction: column; gap: 1px;
              font-size: 12px;
            "
          >
            <div
              style="display: flex; align-items: baseline; gap: 6px; overflow: hidden;"
            >
              <span
                style="color: {$theme.accent}; font-family: monospace; font-size: 11px; flex-shrink: 0;"
                >{commit.short_hash}</span
              >
              <span
                style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                >{commit.subject}</span
              >
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="color: {$theme.fgDim}; font-size: 10px;"
                >{commit.author_name}</span
              >
              <span style="color: {$theme.fgDim}; font-size: 10px;"
                >{formatDate(commit.date)}</span
              >
            </div>
          </div>
        {/each}
      {/if}
    {/if}
  {/if}
</div>

<style>
  .list-item:hover {
    background: rgba(255, 255, 255, 0.05) !important;
  }
  .section-header:hover {
    background: rgba(255, 255, 255, 0.03) !important;
  }
</style>
