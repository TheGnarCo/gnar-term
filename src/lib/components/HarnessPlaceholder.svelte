<script lang="ts">
  import { theme } from "../stores/theme";
  import type { HarnessPlaceholderSurface } from "../types";

  export let surface: HarnessPlaceholderSurface;
  export let visible: boolean;
  export let onRelaunch: () => void;
</script>

{#if visible}
  <div
    style="
      flex: 1; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 16px;
      background: {$theme.bg}; color: {$theme.fgMuted};
      min-height: 0; min-width: 0;
    "
  >
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill={$theme.fgDim}
      style="opacity: 0.5;"
    >
      <path
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h-2v-2h2v2zm0-4h-2V7h2v6zm4 4h-2v-2h2v2zm0-4h-2V7h2v6z"
      />
    </svg>
    <div style="font-size: 14px; font-weight: 500; color: {$theme.fgMuted};">
      {surface.title} closed
    </div>
    <button
      class="relaunch-btn"
      style="
        padding: 8px 20px; border-radius: 6px; cursor: pointer;
        background: {$theme.accent}; color: white; border: none;
        font-size: 13px; font-weight: 500;
      "
      on:click={onRelaunch}>Relaunch Harness</button
    >
  </div>
{/if}

<style>
  .relaunch-btn:hover {
    filter: brightness(1.1);
  }
</style>
