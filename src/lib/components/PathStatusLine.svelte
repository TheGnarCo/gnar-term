<script lang="ts">
  /**
   * PathStatusLine — shared git-status subtitle row used inside
   * container banners (Workspaces + agent dashboards). Renders two lines:
   *
   *   1. the last two path segments (e.g. `Code/my-repo`)
   *   2. git branch when the active terminal is inside a git repo
   *
   * Generic over the target — callers pass an object with `{ id, path,
   * isGit }`. The branch read subscribes to the status registry, which
   * the git-status-service keeps in sync with the workspace's live PTY
   * CWD (OSC 7 / .git/index watcher). That way `cd` between worktrees
   * inside a workspace reflects in the banner without a stale 45s poll.
   *
   * The uncommitted-changes badge previously lived here; it moved to
   * the per-workspace Diff dashboard contribution. Open PR badges also
   * lived here; they moved to the Workspace Overview Dashboard's PRs
   * section, which has the room to render the full list without
   * crowding the banner.
   */
  import { getContext } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../../extensions/api";
  import { getWorkspaceStatusByCategory } from "../services/status-registry";

  export let target: {
    id: string;
    path: string | undefined;
    isGit: boolean;
  };
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

  // Subscribe to git status items the git-status-service publishes for
  // this workspace. The `branch` item's label is `<branch>` plus an
  // optional ` +N -M` suffix; we strip the suffix so the banner shows
  // just the bare branch name.
  $: gitStatusStore = getWorkspaceStatusByCategory(target.id, "git");
  $: branchItem = $gitStatusStore.find((i) => i.id.endsWith(":branch"));
  $: branch = branchItem ? (branchItem.label.split(" ")[0] ?? null) : null;

  $: showFirstRow = Boolean(target?.path);
  $: prettyPath = target?.path
    ? (() => {
        const parts = target.path!.split("/").filter(Boolean);
        return parts.slice(-2).join("/") || target.path!;
      })()
    : "";
</script>

{#if showFirstRow}
  <div
    style="display: flex; flex-direction: column; gap: 0; padding: 0 12px 0 6px; overflow: hidden;"
  >
    <!-- Path row -->
    <div
      style="display: flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden;"
      title={target.path ?? ""}
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
        style="font-size: 10px; color: {fgMuted}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1 1 auto;"
        >{prettyPath}</span
      >
    </div>

    <!-- Git row: branch only. Only rendered when git. -->
    {#if target.isGit}
      <div
        style="display: flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden;"
        title={branch ?? "detached HEAD"}
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
          style="font-size: 10px; color: {fgMuted}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1 1 auto;"
          >{branch ?? "…"}</span
        >
      </div>
    {/if}
  </div>
{/if}
