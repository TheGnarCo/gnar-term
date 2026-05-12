<script lang="ts">
  /**
   * WorkspaceDiffPrSubtitle — compact diff + PR statusline for individual
   * workspace rows. Registered via workspace-subtitle-registry at priority 20.
   *
   * Diff data comes from the git-status-service status registry (already
   * polled) — no duplicate git polling. PR data is read from
   * `repoOpenPrsStore`, the per-repo cache published by `pr-state-poller`.
   * The subtitle registers its `repoRoot` with the poller on mount so a
   * root workspace without branched worktrees still gets its PR list
   * refreshed; the prior 5s `gh_list_prs` poller embedded in this
   * component was a parallel state source for the same data and has
   * been removed.
   */
  import { onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { theme } from "../stores/theme";
  import { getWorkspaceStatusByCategory } from "../services/status-registry";
  import { GIT_STATUS_SOURCE } from "../services/git-status-service";
  import { workspaces } from "../stores/workspace";
  import { isBranchedWorkspace } from "../types";
  import type { StatusItem } from "../types/status";
  import {
    repoOpenPrsStore,
    registerRepoForPrTracking,
    type OpenPrListItem,
  } from "../services/pr-state-poller";

  export let workspaceId: string;
  export let accentColor: string | undefined = undefined;

  // PR rows belong to root-workspace banners only — branches and
  // dashboards inherit the PR status from their owning root, so showing
  // it twice (or on a branch worktree that has no upstream) is noise.
  $: thisWs = $workspaces.find((w) => w.id === workspaceId);
  $: isRootWorkspace =
    thisWs !== undefined &&
    thisWs.rootWorkspaceId === undefined &&
    thisWs.isDashboard !== true &&
    !isBranchedWorkspace(thisWs);

  $: fgMuted = ($theme["fgMuted"] ?? $theme.fgDim) as string;
  $: iconFg = accentColor ?? fgMuted;

  $: gitStatusStore = getWorkspaceStatusByCategory(workspaceId, "git");
  $: gitItems = $gitStatusStore;
  $: branchItem = gitItems.find(
    (i: StatusItem) =>
      i.source === GIT_STATUS_SOURCE && i.id.endsWith(":branch"),
  );
  $: dirtyItem = gitItems.find(
    (i: StatusItem) =>
      i.source === GIT_STATUS_SOURCE && i.id.endsWith(":dirty"),
  );

  interface BranchMeta {
    repoRoot?: string;
    isDetached?: boolean;
    ahead?: number;
    behind?: number;
  }
  $: branchMeta = branchItem?.metadata as BranchMeta | undefined;
  $: repoRoot = branchMeta?.repoRoot;
  $: ahead = branchMeta?.ahead ?? 0;
  $: behind = branchMeta?.behind ?? 0;
  $: showRemote = ahead > 0 || behind > 0;

  $: diffLabel = dirtyItem?.label ?? "";
  $: showDiff = diffLabel.length > 0;

  interface DirtyCounts {
    modified: number;
    added: number;
    deleted: number;
    renamed: number;
    untracked: number;
    staged: number;
  }

  $: counts = (dirtyItem?.metadata as DirtyCounts | undefined) ?? null;
  $: modifiedOnly = counts
    ? Math.max(
        0,
        counts.modified +
          counts.staged -
          counts.added -
          counts.deleted -
          counts.renamed,
      )
    : 0;
  $: diffSegments = counts
    ? [
        modifiedOnly > 0
          ? { label: `~${modifiedOnly}`, color: "#e8b73a" }
          : null,
        counts.added > 0
          ? { label: `+${counts.added}`, color: "#4ec957" }
          : null,
        counts.deleted > 0
          ? { label: `-${counts.deleted}`, color: "#e85454" }
          : null,
        counts.untracked > 0
          ? { label: `?${counts.untracked}`, color: fgMuted }
          : null,
      ].filter(Boolean)
    : [];

  // Track the currently-registered repoRoot so reactive `repoRoot` changes
  // can unregister the previous root before registering the new one. Without
  // this the poller's refcount would leak whenever a row remounts onto a
  // different repo.
  let _unregister: (() => void) | null = null;
  let _trackedRoot: string | null = null;

  $: if (isRootWorkspace && repoRoot && repoRoot !== _trackedRoot) {
    _unregister?.();
    _unregister = registerRepoForPrTracking(repoRoot);
    _trackedRoot = repoRoot;
  }
  $: if ((!isRootWorkspace || !repoRoot) && _trackedRoot) {
    _unregister?.();
    _unregister = null;
    _trackedRoot = null;
  }

  onDestroy(() => {
    _unregister?.();
    _unregister = null;
    _trackedRoot = null;
  });

  // Derive `prs` from the shared store. Tying the displayed list to the
  // row identity by construction rules out the prior "floating PR" race
  // where the previous row's PRs briefly painted after `repoRoot`
  // changed but before the new fetch resolved.
  $: prs = repoRoot
    ? (($repoOpenPrsStore.get(repoRoot) as OpenPrListItem[] | undefined) ??
      null)
    : null;

  $: showPrs = isRootWorkspace && prs !== null && prs.length > 0;
</script>

{#if showDiff || showPrs || showRemote}
  <div
    style="display: flex; flex-direction: column; gap: 0; padding: 0 0 0 6px; flex: 1 1 auto; min-width: 0; overflow: hidden;"
  >
    {#if showDiff || showRemote}
      {@const combinedTitle = [
        showDiff ? (dirtyItem?.tooltip ?? diffLabel) : null,
        ahead > 0 ? `${ahead} ahead` : null,
        behind > 0 ? `${behind} behind` : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      <div
        style="display: flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden;"
        title={combinedTitle}
      >
        {#if showDiff}
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke={iconFg}
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="flex-shrink: 0; opacity: 0.7;"
            aria-hidden="true"
          >
            <path d="M12 3v14" />
            <path d="M5 10h14" />
            <path d="M5 21h14" />
          </svg>
        {:else}
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke={iconFg}
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="flex-shrink: 0; opacity: 0.7;"
            aria-hidden="true"
          >
            <line x1="8" y1="20" x2="8" y2="6" />
            <polyline points="4 10 8 6 12 10" />
            <line x1="16" y1="4" x2="16" y2="18" />
            <polyline points="12 14 16 18 20 14" />
          </svg>
        {/if}
        {#if showDiff}
          {#if diffSegments.length > 0}
            {#each diffSegments as seg}
              <span
                style="font-size: 10px; color: {seg?.color}; white-space: nowrap; flex-shrink: 0;"
                >{seg?.label}</span
              >
            {/each}
          {:else}
            <span
              style="font-size: 10px; color: #e8b73a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1 1 auto;"
              >{diffLabel}</span
            >
          {/if}
        {/if}
        {#if ahead > 0}
          <span
            style="font-size: 10px; color: #4ec957; white-space: nowrap; flex-shrink: 0;"
            >↑{ahead}</span
          >
        {/if}
        {#if behind > 0}
          <span
            style="font-size: 10px; color: #e8b73a; white-space: nowrap; flex-shrink: 0;"
            >↓{behind}</span
          >
        {/if}
      </div>
    {/if}

    {#if showPrs && prs}
      <div
        data-pr-row
        style="display: flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden;"
        title={prs
          .map((p) => `#${p.number} ${p.title}${p.isDraft ? " (draft)" : ""}`)
          .join("\n")}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke={iconFg}
          stroke-width="3"
          stroke-linecap="round"
          stroke-linejoin="round"
          style="flex-shrink: 0; opacity: 0.7;"
          aria-hidden="true"
        >
          <circle cx="18" cy="18" r="3" />
          <circle cx="6" cy="6" r="3" />
          <path d="M13 6h3a2 2 0 0 1 2 2v7" />
          <line x1="6" x2="6" y1="9" y2="21" />
        </svg>
        <span
          style="display: flex; align-items: center; gap: 2px; row-gap: 3px; min-width: 0; overflow: hidden; flex-wrap: wrap;"
        >
          {#each prs as p, i (p.number)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span
              class="pr-link"
              data-pr-number={p.number}
              style="font-size: 10px; color: {p.isDraft
                ? fgMuted
                : '#4ec957'}; white-space: nowrap; flex-shrink: 0; cursor: pointer;"
              title="#{p.number} {p.title}{p.isDraft ? ' (draft)' : ''}"
              on:click|stopPropagation={() =>
                invoke("open_url", { url: p.url })}
            >
              #{p.number}{p.isDraft ? " draft" : ""}
            </span>
            {#if i < prs.length - 1}
              <span
                style="font-size: 10px; color: {fgMuted}; white-space: nowrap; flex-shrink: 0;"
                >,</span
              >
            {/if}
          {/each}
        </span>
      </div>
    {/if}
  </div>
{/if}

<style>
  .pr-link {
    text-decoration: none;
  }
  .pr-link:hover {
    text-decoration: underline;
  }
</style>
