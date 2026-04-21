<script lang="ts">
  /**
   * PathStatusLine — shared git-status subtitle row used inside
   * container banners (projects + agent dashboards). Renders two lines:
   *
   *   1. the last two path segments (e.g. `Code/my-repo`)
   *   2. git branch + open PR numbers when the path is a git repo
   *
   * Generic over the target — callers pass an object with `{ id, path,
   * isGit }`. The id drives caching so switching between projects /
   * dashboards reseeds the poll loop.
   *
   * The uncommitted-changes badge previously lived here; it moved to
   * the per-group Diff dashboard contribution so "open the diff" is
   * consistently a dashboard-tile click.
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

  interface BranchInfo {
    name: string;
    is_current: boolean;
    is_remote: boolean;
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
    prs = [];
    lastTargetId = null;
  }

  onDestroy(() => stop());

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

  <!-- Git row: branch + PRs. Only rendered when git and signals exist. -->
  {#if target.isGit || prs.length > 0}
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
    </div>
  {/if}
{/if}
