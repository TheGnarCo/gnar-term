<script lang="ts">
  import type { ThemeDef } from "../theme-data";

  export let theme: ThemeDef;
  export let visible: boolean = false;
  export let onMouseDown: (e: MouseEvent) => void;
  export let ariaLabel: string = "Drag to reorder";
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  role="button"
  tabindex="-1"
  aria-label={ariaLabel}
  class="drag-grip"
  on:mousedown={onMouseDown}
  style="
    position: absolute;
    left: 0; top: 0; bottom: 0;
    width: 8px;
    cursor: grab;
    opacity: {visible ? 1 : 0};
    transition: opacity 0.12s;
    display: flex; align-items: center; justify-content: center;
    background: transparent;
    z-index: 2;
  "
>
  <span
    style="
      width: 3px; height: 60%;
      border-radius: 2px;
      background: {theme.accent};
      opacity: 0.65;
    "
  ></span>
</div>
