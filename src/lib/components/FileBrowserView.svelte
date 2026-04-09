<script lang="ts">
  import { theme } from "../stores/theme";
  import { pendingAction } from "../stores/ui";
  import type { FileBrowserSurface } from "../types";

  export let surface: FileBrowserSurface;
  export let visible: boolean;

  function handleFileClick(path: string) {
    const fullPath = surface.worktreePath.replace(/\/$/, "") + "/" + path;
    pendingAction.set({ type: "open-preview", payload: fullPath });
  }
</script>

<div
  style="
    flex: 1; overflow: auto; padding: 8px 0;
    font-size: 12px; background: {$theme.bg}; color: {$theme.fg};
    display: {visible ? 'block' : 'none'};
  "
>
  {#if surface.files.length === 0}
    <div
      style="color: {$theme.fgMuted}; font-style: italic; padding: 16px 12px;"
    >
      No tracked files
    </div>
  {:else}
    {#each surface.files as filePath}
      <button
        style="
          width: 100%; background: none; border: none; padding: 3px 12px;
          color: {$theme.fg}; cursor: pointer; display: block;
          font-size: 12px; font-family: monospace; text-align: left;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        "
        on:click={() => handleFileClick(filePath)}
        on:mouseenter={(e) =>
          (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
        on:mouseleave={(e) => (e.currentTarget.style.background = "none")}
      >
        {filePath}
      </button>
    {/each}
  {/if}
</div>
