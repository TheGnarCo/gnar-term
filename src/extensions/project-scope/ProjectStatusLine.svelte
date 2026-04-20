<script lang="ts">
  import { onDestroy, getContext } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../api";
  import type { ProjectEntry } from "./index";

  export let project: ProjectEntry;
  /**
   * Optional override for the subtitle's text color. When the status
   * line sits inside a colored project banner, callers pass the
   * banner's contrast-adjusted foreground so the text stays readable
   * on any project color. Defaults to theme.fgMuted otherwise.
   */
  export let fgColor: string | undefined = undefined;

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;

  // fgMuted is an indexed property — cast to string for type safety
  let themeMuted: string;
  $: themeMuted = ($theme["fgMuted"] ?? $theme.fgDim) as string;
  $: fgMuted = fgColor ?? themeMuted;

  interface BranchInfo {
    name: string;
    is_current: boolean;
    is_remote: boolean;
  }
  interface FileStatus {
    path: string;
    status: string;
    staged: string;
  }
  interface GhPr {
    number: number;
    title: string;
    state: string;
    url: string;
    headRefName: string;
    isDraft: boolean;
  }

  let branch: string | null = null;
  let dirtyCount = 0;
  let prs: GhPr[] = [];
  let branchError = false;
  let lastProjectId: string | null = null;
  let homeDir: string | null = null;

  // Resolve HOME once so prettyCwd works on macOS (/Users/..), Linux
  // (/home/..), and any non-standard layout. Previously hardcoded to
  // /Users/NAME which silently no-op'd on Linux.
  void api
    .invoke<string>("get_home")
    .then((h) => (homeDir = h))
    .catch(() => (homeDir = null));

  // Refresh roughly every 45s while the component is mounted — matches the
  // cadence the workspace-level git status service polls at and is cheap
  // for the 2 gh/git calls we issue.
  const REFRESH_MS = 45_000;

  async function refreshBranch(): Promise<void> {
    try {
      const branches = await api.invoke<BranchInfo[]>("list_branches", {
        repoPath: project.path,
        includeRemote: false,
      });
      const current = branches.find((b) => b.is_current);
      branch = current?.name ?? null;
      branchError = false;
    } catch {
      branch = null;
      branchError = true;
    }
  }

  async function refreshDirty(): Promise<void> {
    try {
      const status = await api.invoke<FileStatus[]>("git_status", {
        repoPath: project.path,
      });
      dirtyCount = status.length;
    } catch {
      dirtyCount = 0;
    }
  }

  async function refreshPrs(): Promise<void> {
    try {
      const list = await api.invoke<GhPr[]>("gh_list_prs", {
        repoPath: project.path,
        state: "open",
      });
      // Cap what we render — 50 is the Rust limit, but even 5 is plenty
      // for a sidebar line. Sort by PR number descending (most recent first).
      prs = list
        .slice()
        .sort((a, b) => b.number - a.number)
        .slice(0, 5);
    } catch {
      prs = [];
    }
  }

  function refreshAll(): void {
    void refreshBranch();
    void refreshDirty();
    void refreshPrs();
  }

  let timer: ReturnType<typeof setInterval> | null = null;

  function start(projectId: string): void {
    if (timer) clearInterval(timer);
    lastProjectId = projectId;
    refreshAll();
    timer = setInterval(refreshAll, REFRESH_MS);
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  // Re-seed whenever this component is bound to a different project.
  $: if (project?.isGit) {
    if (project.id !== lastProjectId) start(project.id);
  } else {
    stop();
    branch = null;
    dirtyCount = 0;
    prs = [];
    lastProjectId = null;
  }

  onDestroy(() => stop());

  function handlePrClick(url: string) {
    const event = new CustomEvent("status-action", {
      detail: { command: "open-url", args: [url] },
      bubbles: true,
    });
    document.dispatchEvent(event);
  }

  $: showFirstRow = Boolean(project);
  // Compact path form: only the parent directory + project directory name,
  // e.g. `Code/agentic-assessment`. The full absolute path is always
  // available via the title attribute on hover.
  $: prettyPath = project
    ? (() => {
        const parts = project.path.split("/").filter(Boolean);
        return parts.slice(-2).join("/") || project.path;
      })()
    : "";
  // Still used: keep homeDir resolve alive so future expansions can use it
  void homeDir;
</script>

{#if showFirstRow}
  <!-- CWD row: project path on its own line. -->
  <div
    style="padding: 2px 12px 0 8px; display: flex; align-items: center; min-width: 0; overflow: hidden; line-height: 1.2;"
  >
    <span
      style="font-size: 10px; color: {fgMuted}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;"
      title={project.path}>{prettyPath}</span
    >
  </div>

  <!-- Git row: branch, open PRs, and dirty count sit together on a
       second line below the path. Only renders when the project is a
       git repo and has at least one git-derived metadata item to show. -->
  {#if project.isGit || prs.length > 0 || dirtyCount > 0}
    <div
      style="padding: 0 12px 2px 8px; display: flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; line-height: 1.2; flex-wrap: wrap;"
    >
      {#if project.isGit}
        <span
          style="font-size: 10px; color: {fgMuted}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-shrink: 0;"
          title={branchError
            ? "Failed to read branch"
            : (branch ?? "detached HEAD")}>⎇ {branch ?? "…"}</span
        >
      {/if}
      {#if project.isGit && prs.length > 0}
        <span
          aria-hidden="true"
          style="font-size: 10px; color: {fgMuted}; opacity: 0.4; flex-shrink: 0;"
          >|</span
        >
      {/if}
      {#if prs.length > 0}
        {#each prs as pr, i (pr.number)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span
            style="font-size: 10px; color: {fgMuted}; cursor: pointer; text-decoration: underline; white-space: nowrap; flex-shrink: 0;"
            title={`#${pr.number} ${pr.title}${pr.isDraft ? " (draft)" : ""}`}
            on:click|stopPropagation={() => handlePrClick(pr.url)}
            >#{pr.number}{pr.isDraft ? "·draft" : ""}</span
          >
          {#if i < prs.length - 1}
            <span
              aria-hidden="true"
              style="font-size: 10px; color: {fgMuted}; opacity: 0.4; flex-shrink: 0;"
              >·</span
            >
          {/if}
        {/each}
      {/if}
      {#if dirtyCount > 0}
        {#if project.isGit || prs.length > 0}
          <span
            aria-hidden="true"
            style="font-size: 10px; color: {fgMuted}; opacity: 0.4; flex-shrink: 0;"
            >|</span
          >
        {/if}
        <span
          style="font-size: 10px; color: #e8b73a; white-space: nowrap; flex-shrink: 0;"
          title="{dirtyCount} file(s) modified in project root"
          >{dirtyCount}·modified</span
        >
      {/if}
    </div>
  {/if}
{/if}
