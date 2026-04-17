<script lang="ts">
  import type { ThemeDef } from "../theme-data";

  export let theme: ThemeDef;
  export let visible: boolean = false;
  export let onMouseDown: (e: MouseEvent) => void;
  export let ariaLabel: string = "Drag to reorder";
  /** Color of the rail and dot texture. Defaults to theme.fgDim (grey). */
  export let railColor: string | undefined = undefined;
  /** Opacity of the always-on rail when not hovered. 1.0 for active items, 0.35 for inactive. */
  export let railOpacity: number = 0.5;

  $: effectiveColor = railColor ?? theme.fgDim;
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  role="button"
  tabindex="-1"
  aria-label={ariaLabel}
  class="drag-grip"
  on:mousedown={onMouseDown}
  style="
    flex-shrink: 0;
    align-self: stretch;
    position: relative;
    width: {visible ? '14px' : '6px'};
    cursor: {visible ? 'grab' : 'default'};
    transition: width 0.12s ease-out;
    overflow: hidden;
  "
>
  <!-- Always-on rail -->
  <div
    style="
      position: absolute;
      left: 0; top: 0; bottom: 0;
      width: {visible ? '3px' : '6px'};
      background: {effectiveColor};
      opacity: {railOpacity};
    "
  ></div>
  <!-- Grippy dots overlay (only when expanded) -->
  {#if visible}
    <div
      style="
        position: absolute;
        inset: 0;
        background-image: radial-gradient({effectiveColor} 1px, transparent 1.5px);
        background-size: 4px 5px;
        background-position: 3px 4px;
        opacity: 0.75;
        pointer-events: none;
      "
    ></div>
  {/if}
</div>
