<script context="module" lang="ts">
  // Module-level PR cache keyed by repoRoot. The collapsed-mode hover
  // popover mounts a fresh subtitle on every hover, so without a cache
  // each hover would re-fetch from `gh_view_pr` and re-paint from
  // `pr = null` → loaded, causing the popover height to jump as the PR
  // row appears. Seeding from the cache on mount paints the loaded
  // state instantly on every hover after the first.
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
  const prCache = new Map<string, GhPrView | null>();
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
   * Renders the same two rows as DiffPrStatusLine but driven by the
   * status registry instead of self-contained polling.
   */
  import { onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { theme } from "../stores/theme";
  import { getWorkspaceStatusByCategory } from "../services/status-registry";
  import { GIT_STATUS_SOURCE } from "../services/git-status-service";
  import { workspaces } from "../stores/workspace";
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
    typeof (thisWs as { worktreePath?: string }).worktreePath !== "string";

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

  let pr: GhPrView | null = null;
  let prTimer: ReturnType<typeof setInterval> | null = null;
  let lastRepoRoot: string | null = null;
  // True once we have any answer for the current repoRoot — either a
  // cache hit on mount, or the initial fetch resolved. Drives the
  // skeleton-placeholder reservation so the popover height stays
  // stable through the very first ever load too.
  let prInitialResolved = false;

  const PR_REFRESH_MS = 5_000;

  async function refreshPr(root: string): Promise<void> {
    try {
      const result = await invoke<GhPrView | null>("gh_view_pr", {
        repoPath: root,
      });
      pr = result ?? null;
      prCache.set(root, pr);
    } catch {
      // Transient failure: don't clobber the cache (so a network blip
      // doesn't flush a known-good PR row), but mark resolved so we
      // stop reserving placeholder space.
      pr = prCache.get(root) ?? null;
    } finally {
      prInitialResolved = true;
    }
  }

  function startPrPolling(root: string): void {
    if (prTimer) clearInterval(prTimer);
    lastRepoRoot = root;
    if (prCache.has(root)) {
      pr = prCache.get(root) ?? null;
      prInitialResolved = true;
    } else {
      pr = null;
      prInitialResolved = false;
    }
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
    pr = null;
    prInitialResolved = false;
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
    style="display: flex; flex-direction: column; gap: 1px; padding: 0 12px 0 6px; overflow: hidden;"
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
          style="font-size: 10px; color: {prColor}; white-space: nowrap; flex-shrink: 0; text-decoration: underline; cursor: pointer;"
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
