<script lang="ts">
  /**
   * DiffPrStatusLine — compact diff + PR statusline for container row
   * banners (workspace groups). Renders two optional rows beneath
   * PathStatusLine:
   *
   *   1. Diff row — [diff icon] M3 A1 D1   (only when working tree is dirty)
   *   2. PR row   — [PR icon] #42 my title  (only when a PR exists for HEAD)
   *
   * Self-contained polling: diff at 30s, PR at 60s. Keyed on `id` so
   * switching projects reseeds both loops immediately.
   */
  import { onDestroy, getContext } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { parseGitStatus } from "../services/git-status-service";
  import type { GitInfo } from "../services/git-status-service";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../../extensions/api";

  export let id: string;
  export let path: string;
  export let isGit: boolean;
  export let fgColor: string | undefined = undefined;
  export let iconColor: string | undefined = undefined;

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;
  $: fgMuted = fgColor ?? (($theme["fgMuted"] ?? $theme.fgDim) as string);
  $: iconFg = iconColor ?? fgMuted;

  interface ScriptResult {
    stdout: string;
    stderr: string;
    exit_code: number;
  }

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

  let gitInfo: GitInfo | null = null;
  let pr: GhPrView | null = null;
  let lastId: string | null = null;
  let diffTimer: ReturnType<typeof setInterval> | null = null;
  let prTimer: ReturnType<typeof setInterval> | null = null;
  let gitRoot: string | null = null;

  const DIFF_REFRESH_MS = 30_000;
  const PR_REFRESH_MS = 5_000;

  async function detectRoot(): Promise<string | null> {
    try {
      const result = await invoke<ScriptResult>("git_rev_parse_toplevel", {
        cwd: path,
      });
      if (!result || result.exit_code !== 0) return null;
      return result.stdout.trim() || null;
    } catch {
      return null;
    }
  }

  async function refreshDiff(): Promise<void> {
    if (!gitRoot) {
      gitRoot = await detectRoot();
    }
    if (!gitRoot) {
      gitInfo = null;
      return;
    }
    try {
      const result = await invoke<ScriptResult>("git_status_short", {
        cwd: gitRoot,
      });
      if (!result || result.exit_code !== 0) {
        gitInfo = null;
        return;
      }
      gitInfo = parseGitStatus(result.stdout) ?? null;
    } catch {
      gitInfo = null;
    }
  }

  async function refreshPr(): Promise<void> {
    if (!gitRoot) {
      gitRoot = await detectRoot();
    }
    if (!gitRoot) {
      pr = null;
      return;
    }
    try {
      const result = await invoke<GhPrView | null>("gh_view_pr", {
        repoPath: gitRoot,
      });
      pr = result ?? null;
    } catch {
      pr = null;
    }
  }

  function start(targetId: string): void {
    stop();
    lastId = targetId;
    gitRoot = null;
    void refreshDiff();
    void refreshPr();
    diffTimer = setInterval(() => void refreshDiff(), DIFF_REFRESH_MS);
    prTimer = setInterval(() => void refreshPr(), PR_REFRESH_MS);
  }

  function stop(): void {
    if (diffTimer) {
      clearInterval(diffTimer);
      diffTimer = null;
    }
    if (prTimer) {
      clearInterval(prTimer);
      prTimer = null;
    }
  }

  $: if (isGit && id !== lastId) start(id);
  $: if (!isGit) {
    stop();
    gitInfo = null;
    pr = null;
    lastId = null;
  }

  onDestroy(() => stop());

  $: modifiedOnly = gitInfo
    ? Math.max(
        0,
        gitInfo.modified +
          gitInfo.staged -
          gitInfo.added -
          gitInfo.deleted -
          gitInfo.renamed,
      )
    : 0;
  $: diffSegments = gitInfo
    ? [
        modifiedOnly > 0
          ? { label: `~${modifiedOnly}`, color: "#e8b73a" }
          : null,
        gitInfo.added > 0
          ? { label: `+${gitInfo.added}`, color: "#4ec957" }
          : null,
        gitInfo.deleted > 0
          ? { label: `-${gitInfo.deleted}`, color: "#e85454" }
          : null,
        gitInfo.untracked > 0
          ? { label: `?${gitInfo.untracked}`, color: fgMuted }
          : null,
      ].filter(Boolean)
    : [];
  $: showDiff = diffSegments.length > 0;
  $: showPr = pr !== null && (pr.state === "OPEN" || pr.state === "open");
  $: isDraft = pr?.isDraft ?? false;
  $: prColor = pr
    ? isDraft
      ? fgMuted
      : ciColor(pr.ciStatus, "#4ec957")
    : fgMuted;
</script>

{#if showDiff || showPr}
  <div
    style="display: flex; flex-direction: column; gap: 1px; padding: 1px 12px 2px 0; overflow: hidden;"
  >
    {#if showDiff}
      <div
        style="display: flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden;"
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
        {#each diffSegments as seg}
          <span
            style="font-size: 10px; color: {seg?.color}; white-space: nowrap; flex-shrink: 0;"
            >{seg?.label}</span
          >
        {/each}
      </div>
    {/if}

    {#if showPr && pr}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        style="display: flex; align-items: center; gap: 3px; min-width: 0; overflow: hidden; cursor: pointer;"
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
  </div>
{/if}
