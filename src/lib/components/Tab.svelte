<script lang="ts">
  import { theme } from "../stores/theme";
  import type { Surface } from "../types";

  export let surface: Surface;
  export let index: number;
  export let isActive: boolean;
  export let onSelect: () => void;
  export let onClose: () => void;
  export let onReorder: ((fromIdx: number, toIdx: number) => void) | undefined =
    undefined;

  let hovered = false;
  let closeHovered = false;
  let dragOver = false;

  function handleDragStart(e: DragEvent) {
    e.dataTransfer?.setData("text/plain", index.toString());
    e.dataTransfer!.effectAllowed = "move";
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const fromIdx = parseInt(e.dataTransfer?.getData("text/plain") || "-1", 10);
    if (fromIdx >= 0 && fromIdx !== index && onReorder) {
      onReorder(fromIdx, index);
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="tab"
  draggable="true"
  style="
    padding: 2px 10px; font-size: 11px; cursor: pointer;
    color: {isActive ? $theme.fg : $theme.fgMuted};
    background: {isActive
    ? $theme.bgActive
    : hovered
      ? $theme.bgHighlight
      : 'transparent'};
    border-bottom: 2px solid {isActive ? $theme.accent : 'transparent'};
    border-radius: 4px 4px 0 0; white-space: nowrap;
    display: flex; align-items: center; gap: 4px;
    {dragOver ? `outline: 1px solid ${$theme.accent};` : ''}
  "
  on:click={onSelect}
  on:mouseenter={() => (hovered = true)}
  on:mouseleave={() => (hovered = false)}
  on:dragstart={handleDragStart}
  on:dragover|preventDefault={() => (dragOver = true)}
  on:dragleave={() => (dragOver = false)}
  on:drop={handleDrop}
>
  {#if surface.hasUnread && !isActive}
    <span
      style="width: 5px; height: 5px; border-radius: 50%; background: {$theme.notify}; flex-shrink: 0;"
    ></span>
  {/if}
  <span style="overflow: hidden; text-overflow: ellipsis;">
    {surface.title || `Shell ${index + 1}`}
  </span>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <span
    style="
      color: {closeHovered
      ? $theme.danger
      : $theme.fgDim}; font-size: 13px; cursor: pointer;
      margin-left: 4px; visibility: {isActive || hovered
      ? 'visible'
      : 'hidden'};
    "
    on:click|stopPropagation={onClose}
    on:mouseenter={() => (closeHovered = true)}
    on:mouseleave={() => (closeHovered = false)}>×</span
  >
</div>
