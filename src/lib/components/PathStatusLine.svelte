<script lang="ts">
  /**
   * PathStatusLine — shared git-status subtitle row used inside
   * container banners (projects + agent dashboards). Renders two lines:
   *
   *   1. the last two path segments (e.g. `Code/my-repo`)
   *   2. git branch + open PR numbers + dirty-count, when the path is a
   *      git repo or has either signal
   *
   * Generic over the target — callers pass an object with `{ id, path,
   * isGit }`. The id drives caching so switching between projects /
   * dashboards reseeds the poll loop.
   *
   * Extracted from project-scope's ProjectStatusLine so agentic-
   * orchestrator can reuse the same renderer for dashboard banners
   * without cross-extension imports.
   */
  import { onDestroy, getContext } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../../extensions/api";

  export let target: { id: string; path: string; isGit: boolean };
  /**
   * Optional override for the subtitle's text color. When the status
   * line sits inside a colored container banner, callers pass the
   * banner's contrast-adjusted foreground so the text stays readable
   * on any banner color. Defaults to theme.fgMuted otherwise.
   */
  export let fgColor: string | undefined = undefined;

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;

  let themeMuted: string;
  $: themeMuted = ($theme["fgMuted"] ?? $theme.fgDim) as string;
  $: fgMuted = fgColor ?? themeMuted;

  // Dirty-count colour adapts to the subtitle foreground:
  //   - light fg (e.g. white on a dark banner) → lighter amber
  //   - dark fg (e.g. black on a yellow banner) → darker amber so the
  //     text doesn't disappear against a warm-coloured background
  // When no banner context is passed (project-scope default — theme
  // fgMuted), fall back to the light amber. The heuristic: strip rgba/#
  // and compare average channel brightness.
  function isDarkForeground(fg: string | undefined): boolean {
    if (!fg) return false;
    const m = fg.match(/#([0-9a-f]{3,6})/i);
    if (m && m[1]) {
      const raw = m[1];
      const hex =
        raw.length === 3
          ? raw
              .split("")
              .map((c) => c + c)
              .join("")
          : raw;
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
    }
    const rgb = fg.match(/(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
    if (rgb && rgb[1] && rgb[2] && rgb[3]) {
      const r = Number(rgb[1]);
      const g = Number(rgb[2]);
      const b = Number(rgb[3]);
      return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
    }
    return false;
  }
  $: dirtyColor = isDarkForeground(fgColor) ? "#7a4a00" : "#e8b73a";

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
  let lastTargetId: string | null = null;

  const REFRESH_MS = 45_000;

  async function refreshBranch(): Promise<void> {
    try {
      const branches = await api.invoke<BranchInfo[]>("list_branches", {
        repoPath: target.path,
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
        repoPath: target.path,
      });
      dirtyCount = status.length;
    } catch {
      dirtyCount = 0;
    }
  }

  async function refreshPrs(): Promise<void> {
    try {
      const list = await api.invoke<GhPr[]>("gh_list_prs", {
        repoPath: target.path,
        state: "open",
      });
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

  function start(id: string): void {
    if (timer) clearInterval(timer);
    lastTargetId = id;
    refreshAll();
    timer = setInterval(refreshAll, REFRESH_MS);
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  $: if (target?.isGit) {
    if (target.id !== lastTargetId) start(target.id);
  } else {
    stop();
    branch = null;
    dirtyCount = 0;
    prs = [];
    lastTargetId = null;
  }

  onDestroy(() => stop());

  function handleDirtyClick() {
    // Open the diff-viewer surface scoped to this target's repo path.
    // App.svelte's "status-action" listener routes this through
    // openExtensionSurfaceInPane.
    const event = new CustomEvent("status-action", {
      detail: {
        command: "open-surface",
        args: [
          "diff-viewer:diff",
          "Uncommitted Changes",
          { repoPath: target.path },
        ],
      },
      bubbles: true,
    });
    document.dispatchEvent(event);
  }

  function handlePrClick(url: string) {
    const event = new CustomEvent("status-action", {
      detail: { command: "open-url", args: [url] },
      bubbles: true,
    });
    document.dispatchEvent(event);
  }

  $: showFirstRow = Boolean(target);
  $: prettyPath = target
    ? (() => {
        const parts = target.path.split("/").filter(Boolean);
        return parts.slice(-2).join("/") || target.path;
      })()
    : "";
</script>

{#if showFirstRow}
  <!-- Path row -->
  <div
    style="padding: 2px 12px 0 8px; display: flex; align-items: center; min-width: 0; overflow: hidden; line-height: 1.2;"
  >
    <span
      style="font-size: 10px; color: {fgMuted}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;"
      title={target.path}>{prettyPath}</span
    >
  </div>

  <!-- Git row: branch + PRs + dirty count. Only when git and signals exist. -->
  {#if target.isGit || prs.length > 0 || dirtyCount > 0}
    <div
      style="padding: 0 12px 2px 8px; display: flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; line-height: 1.2; flex-wrap: wrap;"
    >
      {#if target.isGit}
        <span
          style="font-size: 10px; color: {fgMuted}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-shrink: 0;"
          title={branchError
            ? "Failed to read branch"
            : (branch ?? "detached HEAD")}>⎇ {branch ?? "…"}</span
        >
      {/if}
      {#if target.isGit && prs.length > 0}
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
        {#if target.isGit || prs.length > 0}
          <span
            aria-hidden="true"
            style="font-size: 10px; color: {fgMuted}; opacity: 0.4; flex-shrink: 0;"
            >|</span
          >
        {/if}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span
          style="font-size: 10px; color: {dirtyColor}; white-space: nowrap; flex-shrink: 0; cursor: pointer; text-decoration: underline;"
          title="Open uncommitted changes"
          on:click|stopPropagation={() => handleDirtyClick()}
          >{dirtyCount}·modified</span
        >
      {/if}
    </div>
  {/if}
{/if}
