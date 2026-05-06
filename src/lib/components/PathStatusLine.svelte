<script lang="ts">
  /**
   * PathStatusLine — shared git-status subtitle row used inside
   * container banners (Workspaces + agent dashboards). Renders two lines:
   *
   *   1. the last two path segments (e.g. `Code/my-repo`)
   *   2. git branch when the path is a git repo
   *
   * Generic over the target — callers pass an object with `{ id, path,
   * isGit }`. The id drives caching so switching between Workspaces /
   * dashboards reseeds the poll loop.
   *
   * The uncommitted-changes badge previously lived here; it moved to
   * the per-workspace Diff dashboard contribution. Open PR badges also
   * lived here; they moved to the per-workspace `gnar:prs` widget on
   * the Workspace Overview Dashboard, which has the room to render the
   * full list without crowding the banner.
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
  export let iconColor: string | undefined = undefined;

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

  let branch: string | null = null;
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

  let timer: ReturnType<typeof setInterval> | null = null;

  function start(id: string): void {
    if (timer) clearInterval(timer);
    lastTargetId = id;
    void refreshBranch();
    timer = setInterval(() => void refreshBranch(), REFRESH_MS);
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
    lastTargetId = null;
  }

  onDestroy(() => stop());

  $: showFirstRow = Boolean(target);
  $: prettyPath = target
    ? (() => {
        const parts = target.path.split("/").filter(Boolean);
        return parts.slice(-2).join("/") || target.path;
      })()
    : "";
</script>

{#if showFirstRow}
  <div
    style="display: flex; flex-direction: column; gap: 1px; padding: 0 12px 0 6px; overflow: hidden;"
  >
    <!-- Path row -->
    <div
      style="display: flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden;"
      title={target.path}
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 16 16"
        fill={iconColor ?? fgMuted}
        style="flex-shrink: 0; opacity: 0.7;"
        aria-hidden="true"
      >
        <path
          d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.062 1.5H13.5A1.5 1.5 0 0 1 15 5v7.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5z"
        />
      </svg>
      <span
        style="font-size: 10px; color: {fgMuted}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;"
        >{prettyPath}</span
      >
    </div>

    <!-- Git row: branch only. Only rendered when git. -->
    {#if target.isGit}
      <div
        style="display: flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden;"
        title={branchError
          ? "Failed to read branch"
          : (branch ?? "detached HEAD")}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke={iconColor ?? fgMuted}
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          style="flex-shrink: 0; opacity: 0.7;"
          aria-hidden="true"
        >
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
        <span
          style="font-size: 10px; color: {fgMuted}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-shrink: 0;"
          >{branch ?? "…"}</span
        >
      </div>
    {/if}
  </div>
{/if}
