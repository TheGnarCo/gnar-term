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
          viewBox="0 0 16 16"
          fill={iconFg}
          style="flex-shrink: 0; opacity: 0.7;"
          aria-hidden="true"
        >
          <path
            d="M8 3.5a.5.5 0 0 1 .5.5v3.5H12a.5.5 0 0 1 0 1H8.5V12a.5.5 0 0 1-1 0V8.5H4a.5.5 0 0 1 0-1h3.5V4a.5.5 0 0 1 .5-.5zM3 11.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5z"
          />
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
        <!-- Pull request icon -->
        <svg
          width="10"
          height="10"
          viewBox="0 0 16 16"
          fill={isDraft ? fgMuted : iconFg}
          style="flex-shrink: 0; opacity: 0.7;"
          aria-hidden="true"
        >
          <path
            d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.628a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354Z"
          />
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
