<script context="module" lang="ts">
  import { writable } from "svelte/store";

  // Module-level PR cache keyed by repoRoot. The collapsed-mode hover
  // popover reuses the same subtitle instance with a changing
  // `workspaceId` prop, so without a cache each hover would re-fetch
  // from `gh_view_pr` and re-paint from `pr = null` → loaded, making
  // the popover height jump as the PR row appears.
  //
  // Backing the cache with a writable store (and reassigning the Map
  // on every update) means subscribers re-derive their displayed PR
  // whenever any row's data lands. Combined with deriving `pr` from
  // `(repoRoot, $prCacheStore)` rather than imperatively setting it,
  // this rules out the prior "floating PR" race where the displayed
  // value briefly held the previous row's PR after the prop changed
  // but before the new fetch resolved.
  //
  // MUST live in `<script context="module">` — vars in the per-instance
  // `<script>` are scoped per component instance, not shared across
  // mounts, so an in-instance cache would defeat the purpose.
  export interface GhPrView {
    number: number;
    title: string;
    state: string;
    url: string;
    headRefName: string;
    isDraft: boolean;
    ciStatus: string;
  }
  const prCacheStore = writable(new Map<string, GhPrView | null>());
  function setPrCache(root: string, value: GhPrView | null): void {
    prCacheStore.update((m) => {
      const next = new Map(m);
      next.set(root, value);
      return next;
    });
  }
</script>

<script lang="ts">
  /**
   * WorkspaceDiffPrSubtitle — compact diff + PR statusline for individual
   * workspace rows. Registered via workspace-subtitle-registry at priority 20.
   *
   * Diff data comes from the git-status-service status registry (already
   * polled) — no duplicate git polling. PR is fetched directly via
   * `gh_view_pr` on a 60s timer, keyed on the repo root from the branch
   * item's metadata.
   *
   * Diff comes from the git-status registry; PR is fetched on a 5s
   * timer via `gh_view_pr` to keep CI status fresh. (The slower 60s
   * `pr-state-poller` only resolves lifecycle states — it doesn't
   * carry the full PR view this row renders.)
   */
  import { onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { theme } from "../stores/theme";
  import { getWorkspaceStatusByCategory } from "../services/status-registry";
  import { GIT_STATUS_SOURCE } from "../services/git-status-service";
  import { workspaces } from "../stores/workspace";
  import { isBranchedWorkspace } from "../types";
  import type { StatusItem } from "../types/status";

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

  function ciColor(status: string, fallback: string): string {
    if (status === "SUCCESS") return "#4ec957";
    if (status === "FAILURE") return "#e85454";
    if (status === "PENDING") return "#e8b73a";
    return fallback;
  }

  let prTimer: ReturnType<typeof setInterval> | null = null;
  let lastRepoRoot: string | null = null;

  const PR_REFRESH_MS = 5_000;

  // Derive both `pr` and `prInitialResolved` directly from the
  // current `repoRoot` and the cache store. Imperative assignment
  // would let `pr` lag behind a `repoRoot` change long enough to
  // briefly paint the previous row's PR — exactly the "floating PR"
  // bug. Derived state ties the displayed PR to the row identity by
  // construction.
  $: pr = repoRoot ? ($prCacheStore.get(repoRoot) ?? null) : null;
  $: prInitialResolved = repoRoot ? $prCacheStore.has(repoRoot) : true;

  async function refreshPr(root: string): Promise<void> {
    try {
      const result = await invoke<GhPrView | null>("gh_view_pr", {
        repoPath: root,
      });
      setPrCache(root, result ?? null);
    } catch {
      // Transient failure: don't clobber a known-good cache entry,
      // but seed `null` if we have no prior answer so the placeholder
      // reservation can clear.
      prCacheStore.update((m) => {
        if (m.has(root)) return m;
        const next = new Map(m);
        next.set(root, null);
        return next;
      });
    }
  }

  function startPrPolling(root: string): void {
    if (prTimer) clearInterval(prTimer);
    lastRepoRoot = root;
    void refreshPr(root);
    prTimer = setInterval(() => void refreshPr(root), PR_REFRESH_MS);
  }

  function stopPrPolling(): void {
    if (prTimer) {
      clearInterval(prTimer);
      prTimer = null;
    }
  }

  $: if (repoRoot && repoRoot !== lastRepoRoot) {
    startPrPolling(repoRoot);
  }
  $: if (!repoRoot && lastRepoRoot) {
    stopPrPolling();
    lastRepoRoot = null;
  }

  onDestroy(() => stopPrPolling());

  $: showPr =
    isRootWorkspace &&
    pr !== null &&
    (pr.state === "OPEN" || pr.state === "open");
  // True for root workspaces whose PR fetch hasn't returned yet.
  // Drives a hidden-but-spaced placeholder so the popover paints at
  // its final height from the start instead of jumping when the PR
  // row appears.
  $: prLoading = isRootWorkspace && !!repoRoot && !prInitialResolved;
  $: isDraft = pr?.isDraft ?? false;
  $: prColor = pr
    ? isDraft
      ? fgMuted
      : ciColor(pr.ciStatus, "#4ec957")
    : fgMuted;
</script>

{#if showDiff || showPr || showRemote || prLoading}
  <div
    style="display: flex; flex-direction: column; gap: 0; padding: 0 12px 0 6px; overflow: hidden;"
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
              style="font-size: 10px; color: #e8b73a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"
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

    {#if showPr && pr}
      <div
        data-pr-row
        style="display: flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden;"
        title="#{pr.number} {pr.title}{isDraft ? ' (draft)' : ''}"
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
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span
          class="pr-link"
          style="font-size: 10px; color: {prColor}; white-space: nowrap; flex-shrink: 0; cursor: pointer;"
          on:click|stopPropagation={() =>
            pr && invoke("open_url", { url: pr.url })}
        >
          #{pr.number}{isDraft ? " draft" : ""}
        </span>
      </div>
    {:else if prLoading}
      <!-- Skeleton placeholder: same structure and dimensions as the
           real PR row but invisible. Reserves vertical space so the
           hover popover paints at its loaded height even on the very
           first hover, before `gh_view_pr` resolves. -->
      <div
        data-pr-row-placeholder
        aria-hidden="true"
        style="display: flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden; visibility: hidden;"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="transparent"
          aria-hidden="true"
        >
          <circle cx="18" cy="18" r="3" />
        </svg>
        <span style="font-size: 10px;">#0</span>
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
