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
  import { nestedWorkspaces } from "../stores/workspace";
  import { getWorkspaceStatusByCategory } from "../services/status-registry";
  import { GIT_STATUS_SOURCE } from "../services/git-status-service";
  import { wsMeta } from "../services/service-helpers";
  import type { StatusItem } from "../types/status";

  export let workspaceId: string;
  export let accentColor: string | undefined = undefined;

  $: currentWs = $nestedWorkspaces.find((w) => w.id === workspaceId);
  $: isNested = Boolean(currentWs && wsMeta(currentWs).parentWorkspaceId);

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

  interface GhPrView {
    number: number;
    title: string;
    state: string;
    url: string;
    headRefName: string;
    isDraft: boolean;
    ciStatus: string;
  }

  function ciColor(status: string, fallback: string): string {
    if (status === "SUCCESS") return "#4ec957";
    if (status === "FAILURE") return "#e85454";
    if (status === "PENDING") return "#e8b73a";
    return fallback;
  }

  let pr: GhPrView | null = null;
  let prTimer: ReturnType<typeof setInterval> | null = null;
  let lastRepoRoot: string | null = null;

  const PR_REFRESH_MS = 5_000;

  async function refreshPr(root: string): Promise<void> {
    try {
      const result = await invoke<GhPrView | null>("gh_view_pr", {
        repoPath: root,
      });
      pr = result ?? null;
    } catch {
      pr = null;
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
    pr = null;
    lastRepoRoot = null;
  }

  onDestroy(() => stopPrPolling());

  $: showPr =
    !isNested && pr !== null && (pr.state === "OPEN" || pr.state === "open");
  $: isDraft = pr?.isDraft ?? false;
  $: prColor = pr
    ? isDraft
      ? fgMuted
      : ciColor(pr.ciStatus, "#4ec957")
    : fgMuted;
</script>

{#if showDiff || showPr || showRemote}
  <div
    style="display: flex; flex-direction: column; gap: 1px; padding: 0 12px 4px 6px; overflow: hidden;"
  >
    {#if showDiff}
      <div
        style="display: flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden;"
        title={dirtyItem?.tooltip ?? diffLabel}
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
          <path d="M12 3v14" />
          <path d="M5 10h14" />
          <path d="M5 21h14" />
        </svg>
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
      </div>
    {/if}

    {#if showPr && pr}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        style="display: flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden; cursor: pointer;"
        title="#{pr.number} {pr.title}{isDraft ? ' (draft)' : ''}"
        on:click={() => pr && invoke("open_url", { url: pr.url })}
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
          style="font-size: 10px; color: {prColor}; white-space: nowrap; flex-shrink: 0; text-decoration: underline;"
        >
          #{pr.number}{isDraft ? " draft" : ""}
        </span>
      </div>
    {/if}

    {#if showRemote}
      <div
        style="display: flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden;"
        title="{ahead > 0 ? `${ahead} ahead` : ''}{ahead > 0 && behind > 0
          ? ', '
          : ''}{behind > 0 ? `${behind} behind` : ''} of remote"
      >
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
  </div>
{/if}
