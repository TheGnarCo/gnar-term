<script lang="ts">
  import { onMount } from "svelte";
  import { theme } from "../stores/theme";
  import type { DiffSurface } from "../types";
  import type { FileStatus } from "../git";
  import {
    gitStatus,
    gitDiff,
    gitDiffStaged,
    gitAdd,
    gitCommit,
    gitPush,
    gitBranchName,
    ghCreatePr,
  } from "../git";

  export let surface: DiffSurface;
  export let visible: boolean;

  // --- State ---

  let fileStatuses: FileStatus[] = [];
  let branchName = "";
  let diffContent = surface.diffContent;
  let loading = false;
  let error = "";
  let successMessage = "";

  // Workflow step tracking
  let commitInputVisible = false;
  let commitMessage = "";
  let prFormVisible = false;
  let prTitle = "";
  let prBody = "";
  let prDraft = false;

  // Derived counts
  $: stagedCount = fileStatuses.filter(
    (f) => f.indexStatus !== " " && f.indexStatus !== "?",
  ).length;
  $: unstagedCount =
    fileStatuses.filter((f) => f.workStatus !== " ").length +
    fileStatuses.filter((f) => f.indexStatus === "?").length;

  // Button enable states
  $: canStage = unstagedCount > 0 && !loading;
  $: canCommit = stagedCount > 0 && !loading;
  $: canPush = !loading;
  $: canCreatePr =
    branchName !== "" &&
    branchName !== "main" &&
    branchName !== "master" &&
    !loading;

  // --- Actions ---

  async function refresh(): Promise<void> {
    if (!surface.worktreePath) return;
    loading = true;
    error = "";
    try {
      const [statuses, branch, diff] = await Promise.all([
        gitStatus(surface.worktreePath),
        gitBranchName(surface.worktreePath),
        gitDiff(surface.worktreePath, surface.filePath),
      ]);
      fileStatuses = statuses;
      branchName = branch;
      diffContent = diff;
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  async function handleStageAll(): Promise<void> {
    if (!surface.worktreePath) return;
    loading = true;
    error = "";
    successMessage = "";
    try {
      await gitAdd(surface.worktreePath);
      await refresh();
      successMessage = "All changes staged";
    } catch (e) {
      error = `Stage failed: ${e}`;
    } finally {
      loading = false;
    }
  }

  function showCommitInput(): void {
    commitInputVisible = true;
    prFormVisible = false;
    successMessage = "";
  }

  async function handleCommit(): Promise<void> {
    if (!surface.worktreePath || !commitMessage.trim()) return;
    loading = true;
    error = "";
    successMessage = "";
    try {
      const hash = await gitCommit(surface.worktreePath, commitMessage);
      successMessage = `Committed: ${hash}`;
      commitMessage = "";
      commitInputVisible = false;
      await refresh();
    } catch (e) {
      error = `Commit failed: ${e}`;
    } finally {
      loading = false;
    }
  }

  function handleCommitKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      handleCommit();
    }
  }

  async function handlePush(): Promise<void> {
    if (!surface.worktreePath) return;
    loading = true;
    error = "";
    successMessage = "";
    try {
      const branch = await gitPush(surface.worktreePath);
      successMessage = `Pushed branch: ${branch}`;
    } catch (e) {
      error = `Push failed: ${e}`;
    } finally {
      loading = false;
    }
  }

  function showPrForm(): void {
    prFormVisible = true;
    commitInputVisible = false;
    successMessage = "";
    // Pre-fill PR title from branch name
    if (!prTitle) {
      prTitle = branchName
        .replace(/[-_/]/g, " ")
        .replace(/^\w/, (c) => c.toUpperCase());
    }
  }

  async function handleCreatePr(): Promise<void> {
    if (!surface.worktreePath || !prTitle.trim()) return;
    loading = true;
    error = "";
    successMessage = "";
    try {
      const url = await ghCreatePr(
        surface.worktreePath,
        prTitle,
        prBody || undefined,
        undefined,
        prDraft,
      );
      successMessage = `PR created: ${url}`;
      prFormVisible = false;
      prTitle = "";
      prBody = "";
      prDraft = false;
    } catch (e) {
      error = `PR creation failed: ${e}`;
    } finally {
      loading = false;
    }
  }

  function lineColor(line: string): string {
    if (line.startsWith("+") && !line.startsWith("+++"))
      return $theme.ansi.green;
    if (line.startsWith("-") && !line.startsWith("---")) return $theme.ansi.red;
    if (line.startsWith("@@")) return $theme.ansi.cyan;
    return $theme.fg;
  }

  onMount(() => {
    refresh();
  });
</script>

<div
  style="
    flex: 1; display: {visible ? 'flex' : 'none'}; flex-direction: column;
    background: {$theme.bg}; color: {$theme.fg};
    font-family: monospace; font-size: 12px;
  "
>
  <!-- Status bar -->
  <div
    style="
      display: flex; align-items: center; gap: 12px;
      padding: 4px 12px;
      background: {$theme.bgSurface ?? $theme.bg};
      border-bottom: 1px solid {$theme.border};
      font-size: 11px; flex-shrink: 0;
    "
  >
    <span style="color: {$theme.fgMuted};">
      {branchName || "..."}
    </span>
    <span style="color: {$theme.ansi.green};" title="Staged files">
      +{stagedCount}
    </span>
    <span style="color: {$theme.ansi.yellow};" title="Unstaged changes">
      ~{unstagedCount}
    </span>
    {#if loading}
      <span style="color: {$theme.fgMuted}; font-style: italic;"
        >loading...</span
      >
    {/if}
  </div>

  <!-- Action toolbar -->
  <div
    style="
      display: flex; align-items: center; gap: 6px;
      padding: 4px 12px;
      background: {$theme.bgSurface ?? $theme.bg};
      border-bottom: 1px solid {$theme.border};
      flex-shrink: 0;
    "
  >
    <button
      on:click={handleStageAll}
      disabled={!canStage}
      style="
        background: none; border: 1px solid {$theme.fgMuted};
        color: {canStage ? $theme.fg : $theme.fgMuted};
        padding: 2px 8px; border-radius: 3px; cursor: {canStage
        ? 'pointer'
        : 'default'};
        font-family: monospace; font-size: 11px;
        opacity: {canStage ? 1 : 0.5};
      "
    >
      Stage All
    </button>

    <button
      on:click={showCommitInput}
      disabled={!canCommit}
      style="
        background: none; border: 1px solid {$theme.fgMuted};
        color: {canCommit ? $theme.fg : $theme.fgMuted};
        padding: 2px 8px; border-radius: 3px; cursor: {canCommit
        ? 'pointer'
        : 'default'};
        font-family: monospace; font-size: 11px;
        opacity: {canCommit ? 1 : 0.5};
      "
    >
      Commit
    </button>

    <button
      on:click={handlePush}
      disabled={!canPush}
      style="
        background: none; border: 1px solid {$theme.fgMuted};
        color: {canPush ? $theme.fg : $theme.fgMuted};
        padding: 2px 8px; border-radius: 3px; cursor: {canPush
        ? 'pointer'
        : 'default'};
        font-family: monospace; font-size: 11px;
        opacity: {canPush ? 1 : 0.5};
      "
    >
      Push
    </button>

    <button
      on:click={showPrForm}
      disabled={!canCreatePr}
      style="
        background: none; border: 1px solid {$theme.fgMuted};
        color: {canCreatePr ? $theme.fg : $theme.fgMuted};
        padding: 2px 8px; border-radius: 3px; cursor: {canCreatePr
        ? 'pointer'
        : 'default'};
        font-family: monospace; font-size: 11px;
        opacity: {canCreatePr ? 1 : 0.5};
      "
    >
      Create PR
    </button>

    <div style="flex: 1;"></div>

    <button
      on:click={refresh}
      disabled={loading}
      style="
        background: none; border: 1px solid {$theme.fgMuted};
        color: {$theme.fg}; padding: 2px 8px; border-radius: 3px;
        cursor: pointer; font-family: monospace; font-size: 11px;
      "
    >
      Refresh
    </button>
  </div>

  <!-- Feedback messages -->
  {#if error}
    <div
      style="
        padding: 4px 12px; font-size: 11px;
        color: {$theme.ansi.red}; background: {$theme.bgSurface ?? $theme.bg};
        border-bottom: 1px solid {$theme.border};
        flex-shrink: 0;
      "
    >
      {error}
    </div>
  {/if}
  {#if successMessage}
    <div
      style="
        padding: 4px 12px; font-size: 11px;
        color: {$theme.ansi.green}; background: {$theme.bgSurface ?? $theme.bg};
        border-bottom: 1px solid {$theme.border};
        flex-shrink: 0;
      "
    >
      {successMessage}
    </div>
  {/if}

  <!-- Commit input -->
  {#if commitInputVisible}
    <div
      style="
        padding: 8px 12px;
        background: {$theme.bgSurface ?? $theme.bg};
        border-bottom: 1px solid {$theme.border};
        flex-shrink: 0;
      "
    >
      <input
        bind:value={commitMessage}
        on:keydown={handleCommitKeydown}
        placeholder="Commit message (Cmd+Enter to submit)"
        style="
          width: 100%; box-sizing: border-box;
          background: {$theme.bg}; color: {$theme.fg};
          border: 1px solid {$theme.fgMuted}; border-radius: 3px;
          padding: 4px 8px; font-family: monospace; font-size: 11px;
        "
      />
      <div style="display: flex; gap: 6px; margin-top: 4px;">
        <button
          on:click={handleCommit}
          disabled={!commitMessage.trim() || loading}
          style="
            background: none; border: 1px solid {$theme.fgMuted};
            color: {commitMessage.trim() ? $theme.fg : $theme.fgMuted};
            padding: 2px 8px; border-radius: 3px;
            cursor: {commitMessage.trim() ? 'pointer' : 'default'};
            font-family: monospace; font-size: 11px;
          "
        >
          Submit
        </button>
        <button
          on:click={() => {
            commitInputVisible = false;
            commitMessage = "";
          }}
          style="
            background: none; border: 1px solid {$theme.fgMuted};
            color: {$theme.fg}; padding: 2px 8px; border-radius: 3px;
            cursor: pointer; font-family: monospace; font-size: 11px;
          "
        >
          Cancel
        </button>
      </div>
    </div>
  {/if}

  <!-- PR form -->
  {#if prFormVisible}
    <div
      style="
        padding: 8px 12px;
        background: {$theme.bgSurface ?? $theme.bg};
        border-bottom: 1px solid {$theme.border};
        flex-shrink: 0;
      "
    >
      <input
        bind:value={prTitle}
        placeholder="PR title"
        style="
          width: 100%; box-sizing: border-box;
          background: {$theme.bg}; color: {$theme.fg};
          border: 1px solid {$theme.fgMuted}; border-radius: 3px;
          padding: 4px 8px; font-family: monospace; font-size: 11px;
          margin-bottom: 4px;
        "
      />
      <textarea
        bind:value={prBody}
        placeholder="PR description (optional)"
        rows="3"
        style="
          width: 100%; box-sizing: border-box;
          background: {$theme.bg}; color: {$theme.fg};
          border: 1px solid {$theme.fgMuted}; border-radius: 3px;
          padding: 4px 8px; font-family: monospace; font-size: 11px;
          resize: vertical; margin-bottom: 4px;
        "
      ></textarea>
      <div style="display: flex; align-items: center; gap: 8px;">
        <label
          style="font-size: 11px; color: {$theme.fg}; display: flex; align-items: center; gap: 4px;"
        >
          <input type="checkbox" bind:checked={prDraft} />
          Draft
        </label>
        <button
          on:click={handleCreatePr}
          disabled={!prTitle.trim() || loading}
          style="
            background: none; border: 1px solid {$theme.fgMuted};
            color: {prTitle.trim() ? $theme.fg : $theme.fgMuted};
            padding: 2px 8px; border-radius: 3px;
            cursor: {prTitle.trim() ? 'pointer' : 'default'};
            font-family: monospace; font-size: 11px;
          "
        >
          Create
        </button>
        <button
          on:click={() => {
            prFormVisible = false;
          }}
          style="
            background: none; border: 1px solid {$theme.fgMuted};
            color: {$theme.fg}; padding: 2px 8px; border-radius: 3px;
            cursor: pointer; font-family: monospace; font-size: 11px;
          "
        >
          Cancel
        </button>
      </div>
    </div>
  {/if}

  <!-- Diff content -->
  <div
    style="
      flex: 1; overflow: auto; padding: 8px 12px;
      line-height: 1.5; white-space: pre; tab-size: 4;
    "
  >
    {#if diffContent}
      {#each diffContent.split("\n") as line}
        <div style="color: {lineColor(line)};">{line}</div>
      {/each}
    {:else}
      <div
        style="color: {$theme.fgMuted}; font-style: italic; padding: 16px 0;"
      >
        No changes
      </div>
    {/if}
  </div>
</div>
