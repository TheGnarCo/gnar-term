<script lang="ts">
  import { theme } from "../../lib/stores/theme";
  import { diffStatsStore } from "./diff-stats-store";

  export let workspaceId: string;
  // accentColor is provided by WorkspaceItem but unused here
  export let accentColor: string | undefined = undefined;

  $: stats = $diffStatsStore[workspaceId];
  $: fgMuted = (($theme["fgMuted"] ?? $theme.fgDim) as string) || "#888";
</script>

{#if stats && (stats.added > 0 || stats.deleted > 0)}
  <div class="diff-stat-line" style:color={fgMuted}>
    <span class="added">+{stats.added}</span>
    <span class="sep">&nbsp;</span>
    <span class="deleted">-{stats.deleted}</span>
  </div>
{/if}

<style>
  .diff-stat-line {
    display: flex;
    align-items: center;
    font-size: 11px;
    line-height: 1.4;
    padding: 0 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .added {
    color: #4ec957;
  }

  .deleted {
    color: #e85454;
  }

  .sep {
    display: inline-block;
    width: 4px;
  }
</style>
