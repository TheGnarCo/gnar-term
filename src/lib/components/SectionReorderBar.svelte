<script lang="ts">
  import type { ThemeDef } from "../theme-data";

  export let theme: ThemeDef;
  export let onSave: () => void;
  export let onCancel: () => void;
</script>

<div
  style="
    flex-shrink: 0; display: flex; gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid {theme.border};
  "
>
  <button
    on:click={onCancel}
    style="
      flex: 1; padding: 5px 0; border-radius: 4px;
      background: transparent; border: 1px solid {theme.border};
      color: {theme.fgDim}; font-size: 12px; cursor: pointer;
    "
  >
    Cancel
  </button>
  <button
    on:click={onSave}
    style="
      flex: 1; padding: 5px 0; border-radius: 4px;
      background: {theme.accent}; border: none;
      color: {theme.bg}; font-size: 12px; font-weight: 600;
      cursor: pointer;
    "
  >
    Save
  </button>
</div>
