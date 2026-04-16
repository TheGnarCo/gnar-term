<script lang="ts">
  import type { ThemeDef } from "../theme-data";

  export let blockId: string;
  export let label: string;
  export let theme: ThemeDef;
  export let onMouseDown: (e: MouseEvent) => void;
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-section-drag={blockId}
  on:mousedown={onMouseDown}
  style="
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: flex-start;
    padding-left: 12px; gap: 8px; cursor: grab;
    background: {theme.sidebarBg}cc;
    border-radius: 6px;
  "
>
  <svg
    width="10"
    height="14"
    viewBox="0 0 10 14"
    fill={theme.fgDim}
    style="flex-shrink: 0;"
  >
    <circle cx="3" cy="3" r="1.2" />
    <circle cx="7" cy="3" r="1.2" />
    <circle cx="3" cy="7" r="1.2" />
    <circle cx="7" cy="7" r="1.2" />
    <circle cx="3" cy="11" r="1.2" />
    <circle cx="7" cy="11" r="1.2" />
  </svg>
  <span
    style="font-size: 11px; font-weight: 600; letter-spacing: 0.5px;
      text-transform: uppercase; color: {theme.fg};
      flex: 1; text-align: center;"
  >
    {label}
  </span>
</div>
