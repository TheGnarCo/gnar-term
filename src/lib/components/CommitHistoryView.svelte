<script lang="ts">
  import { theme } from "../stores/theme";
  import type { CommitHistorySurface } from "../types";

  export let surface: CommitHistorySurface;
  export let visible: boolean;
</script>

<div
  style="
    flex: 1; overflow: auto; padding: 8px 0;
    font-size: 12px; background: {$theme.bg}; color: {$theme.fg};
    display: {visible ? 'block' : 'none'};
  "
>
  {#if surface.commits.length === 0}
    <div
      style="color: {$theme.fgMuted}; font-style: italic; padding: 16px 12px;"
    >
      No commits
    </div>
  {:else}
    {#each surface.commits as commit}
      <div
        style="
          padding: 6px 12px; display: flex; flex-direction: column; gap: 2px;
          border-bottom: 1px solid {$theme.border};
        "
      >
        <div style="font-size: 12px; color: {$theme.fg};">
          {commit.subject}
        </div>
        <div
          style="font-size: 11px; color: {$theme.fgMuted}; display: flex; gap: 8px; font-family: monospace;"
        >
          <span style="color: {$theme.accent || $theme.fg};"
            >{commit.shortHash}</span
          >
          <span>{commit.author}</span>
          <span>{commit.date}</span>
        </div>
      </div>
    {/each}
  {/if}
</div>
