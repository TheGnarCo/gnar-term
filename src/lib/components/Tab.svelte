<script lang="ts">
  import { theme } from "../stores/theme";
  import type { Surface } from "../types";
  import { startTabDrag } from "../services/tab-drag";

  export let surface: Surface;
  export let index: number;
  export let isActive: boolean;
  /** Whether the owning pane is the focused pane — greys the active underline
   *  when false so the focused tab ties to the focused pane. */
  export let paneIsActive: boolean = false;
  export let onSelect: () => void;
  export let onClose: () => void;
  /** Pane + workspace that own this tab — needed to resolve drop targets. */
  export let paneId: string;
  export let workspaceId: string;

  let hovered = false;
  let closeHovered = false;

  // Arm the mouse-driven tab drag (reorder / cross-pane merge / split). The
  // engine preventDefaults mousedown but lets the subsequent click through, so
  // tab selection and the close button still work when no drag occurs.
  function handleMousedown(e: MouseEvent) {
    startTabDrag(e, surface.id, paneId, workspaceId);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="tab"
  data-tab-surface-id={surface.id}
  data-tab-idx={index}
  style="
    padding: 2px 10px; font-size: 11px; cursor: pointer;
    color: {isActive ? $theme.fg : $theme.fgMuted};
    background: {isActive ? $theme.bgActive : hovered ? $theme.bgHighlight : 'transparent'};
    border-bottom: 2px solid {isActive ? (paneIsActive ? $theme.accent : $theme.border) : 'transparent'};
    border-radius: 4px 4px 0 0; white-space: nowrap;
    display: flex; align-items: center; gap: 4px;
  "
  on:click={onSelect}
  on:mousedown={handleMousedown}
  on:mouseenter={() => hovered = true}
  on:mouseleave={() => hovered = false}
>
  {#if surface.hasUnread && !isActive}
    <span style="width: 5px; height: 5px; border-radius: 50%; background: {$theme.notify}; flex-shrink: 0;"></span>
  {/if}
  <span style="overflow: hidden; text-overflow: ellipsis;">
    {surface.title || `Shell ${index + 1}`}
  </span>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <span
    style="
      color: {closeHovered ? $theme.danger : $theme.fgDim}; font-size: 13px; cursor: pointer;
      margin-left: 4px; visibility: {isActive || hovered ? 'visible' : 'hidden'};
    "
    on:click|stopPropagation={onClose}
    on:mouseenter={() => closeHovered = true}
    on:mouseleave={() => closeHovered = false}
  >×</span>
</div>
