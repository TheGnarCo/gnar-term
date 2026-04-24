<script lang="ts">
  import { onMount } from "svelte";
  import { listClaudeDir } from "../../lib/claude-settings-service";
  import type { ClaudeDirEntry } from "../../lib/claude-settings-service";

  export let dirPath: string;
  export let label: string;
  export let theme: { fg: string; fgDim: string; bg: string; border: string };

  let entries: ClaudeDirEntry[] = [];
  let error = "";
  let loading = true;

  onMount(async () => {
    try {
      entries = await listClaudeDir(dirPath);
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  });
</script>

<div class="dir-section">
  {#if loading}
    <span style="color: {theme.fgDim}; font-size: 12px;">Loading…</span>
  {:else if error}
    <span style="color: {theme.fgDim}; font-size: 11px; font-style: italic;"
      >{dirPath} not found</span
    >
  {:else if entries.length === 0}
    <span style="color: {theme.fgDim}; font-size: 12px;"
      >No {label.toLowerCase()} found in {dirPath}</span
    >
  {:else}
    {#each entries as entry}
      <div class="entry" style="color: {theme.fg};">
        <span style="font-size: 11px; color: {theme.fgDim};"
          >{entry.is_dir ? "📁" : "📄"}</span
        >
        <code style="font-size: 12px;">{entry.name}</code>
      </div>
    {/each}
  {/if}
  <div style="margin-top: 6px; font-size: 10px; color: {theme.fgDim};">
    {dirPath}
  </div>
</div>

<style>
  .dir-section {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .entry {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
  }
</style>
